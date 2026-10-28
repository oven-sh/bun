use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Bound, Decl, Parent, SymbolId};
use bun_sema::check::aot::{find_link_followed_by_transpiler, is_member_visited_before};
use bun_sema::fold::{self, Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, EnumId, EnumMemberId, ExprId, ExprKind, Flags, MemberKey, StmtKind, UnOp,
    VarDeclId,
};
use bun_sema::hir_from_data::DataValue;
use bun_sema::program::{FileId, Files, Sym};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::{ExportBinding, ImportBinding, Member, ModuleGraph, ModuleKind, ModuleRef};
use crate::statistics::{LimitId, LimitValues};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Validity {
    /// `bun run` has the value in the place of the read too, or the enum is a `const enum`.
    Always,
    /// The file of the enum has run when the read runs. The member holds the value as long as nothing can store to the object.
    WhileObjectIsNotHandedOn,
}

/// `Color.Green`, `Color["Green"]`, `shapes.Color.Green`, `data.nested.port`: a read of a member whose value the build knows.
#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct MemberRead {
    /// The variable that holds the object.
    pub object: Sym,
    pub value: Constant,
    pub validity: Validity,
}

#[derive(Copy, Clone)]
struct MemberValue {
    value: Constant,
    // No transpiler works it out for an executable, so a read in the file of the enum reads the object: it throws before the enum has run.
    is_known_to_build_alone: bool,
}

struct DeclarationValues {
    members: Box<[Option<MemberValue>]>,
    // The enums of other files whose members the initializers read. The values hold as long as nothing can store to the objects of those.
    relies_on: Box<[Sym]>,
}

type MemberValues = Rc<DeclarationValues>;

// Which members an initializer may name for its value to be known.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Named {
    // Those of its own declaration, and those of the declarations that have run before it.
    OwnAndEarlier,
    Own,
}

type DeclarationKey = (FileId, EnumId, Named);

// The initializers of a declaration, while they are evaluated in their order.
#[derive(Copy, Clone)]
struct Initializers<'a> {
    file: FileId,
    declaration: EnumId,
    earlier: &'a [Option<MemberValue>],
    named: Named,
    // Whether the initializer that is evaluated rests on a value that the build alone knows.
    is_known_to_build_alone: &'a Cell<bool>,
    relies_on: &'a RefCell<Vec<Sym>>,
    // A declaration whose values an initializer asks for, and that nobody has evaluated yet.
    asked_for: &'a Cell<Option<DeclarationKey>>,
}

#[derive(Default)]
pub(crate) struct KnownMemberValues {
    by_declaration: RefCell<FxHashMap<DeclarationKey, MemberValues>>,
}

/// The objects that the build knows whole because nothing but their declaration fills them: the enums at the top of the files of a program, and the
/// values of its modules of data. Each is found by binding.
#[derive(Copy, Clone)]
pub(crate) struct KnownObjects<'a, 's> {
    pub files: &'a Files<'s>,
    pub graph: &'a ModuleGraph,
    pub known: &'a KnownMemberValues,
    pub limits: &'a LimitValues,
}

// The parent of an expression, past the type assertions around it, and the outermost of those.
fn find_parent(hir: &hir::File<'_>, bound: &Bound<'_>, expression: ExprId) -> (ExprId, Parent) {
    let mut outermost = expression;
    loop {
        match bound.parent_of_expr(outermost) {
            Parent::Expr(parent) if hir.type_assertion_operand(parent) == Some(outermost) => {
                outermost = parent;
            }
            parent => return (outermost, parent),
        }
    }
}

// Nothing is stored or deleted there, and nothing is called with the object as `this`.
fn is_plain_read(hir: &hir::File<'_>, bound: &Bound<'_>, access: ExprId) -> bool {
    let (outermost, parent) = find_parent(hir, bound, access);
    if bound.get_assignment_target(hir, outermost).is_some() {
        return false;
    }
    let Parent::Expr(parent) = parent else {
        return true;
    };
    match hir[parent].kind {
        ExprKind::Unary { op, .. } => op != UnOp::Delete,
        ExprKind::Call(call) => hir[call].callee != outermost,
        ExprKind::TaggedTemplate(template) => hir[template].callee != outermost,
        _ => true,
    }
}

fn is_link_of_no_chain(hir: &hir::File<'_>, access: ExprId) -> bool {
    matches!(
        hir[access].kind,
        ExprKind::Dot {
            chain: Chain::No,
            ..
        } | ExprKind::Index {
            chain: Chain::No,
            ..
        }
    )
}

pub(crate) fn is_enum(bound: &Bound<'_>, symbol: SymbolId) -> bool {
    matches!(bound.symbol(symbol).decls.first(), Some(Decl::Enum(_)))
}

impl<'a, 's> KnownObjects<'a, 's> {
    fn follow_imports(&self, mut defined: Sym) -> Option<Sym> {
        loop {
            if !self.graph.has_record(defined.file) {
                return None;
            }
            match self.graph.import_binding(defined.file, defined.id) {
                ImportBinding::Local => return Some(defined),
                ImportBinding::Variable(elsewhere) if elsewhere != defined => defined = elsewhere,
                _ => return None,
            }
        }
    }

    /// The enum whose object the expression evaluates to: a name, or a member of the object of a module.
    pub(crate) fn find_enum(&self, file: FileId, expression: ExprId) -> Option<Sym> {
        if !self.graph.has_record(file) {
            return None;
        }
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        let named = match hir[expression].kind {
            ExprKind::Ident(_) => match bound.binding(expression) {
                Binding::Symbol(id) => Sym { file, id },
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => return None,
            },
            ExprKind::Dot { .. } | ExprKind::Index { .. }
                if is_link_of_no_chain(hir, expression) =>
            {
                match (
                    self.graph.member_binding(file, expression),
                    self.graph.member(file, expression),
                ) {
                    (Some(ImportBinding::Variable(defined)), _)
                    | (None, Some(Member::Binding(defined))) => defined,
                    _ => return None,
                }
            }
            _ => return None,
        };
        let defined = self.follow_imports(named)?;
        let (hir, bound) = (self.files.hir(defined.file), self.files.bound(defined.file));
        let is_made_at_top_of_file = |&declaration: &Decl| match declaration {
            Decl::Enum(declaration) => {
                let node = &hir[declaration];
                !node.flags.contains(Flags::AMBIENT)
                    && bound.parent_of_stmt(node.stmt) == Parent::File
            }
            _ => false,
        };
        let declarations = bound.symbol(defined.id).decls;
        // Text that is evaluated in a scope of the file names what it likes.
        let is_known_whole = !declarations.is_empty()
            && declarations.iter().all(is_made_at_top_of_file)
            && bound.runtime.eval_scopes().is_empty();
        is_known_whole.then_some(defined)
    }

    fn find_member(&self, enumeration: Sym, name: Atom) -> Option<(EnumId, EnumMemberId)> {
        let (hir, bound) = (
            self.files.hir(enumeration.file),
            self.files.bound(enumeration.file),
        );
        let mut found = None;
        for &declaration in bound.symbol(enumeration.id).decls {
            let Decl::Enum(declaration) = declaration else {
                return None;
            };
            for member in hir[declaration].members.iter() {
                if hir[member].computed_name.is_none() && hir[member].name == name {
                    // A later member of the same name stores over the earlier one.
                    if found.is_some() {
                        return None;
                    }
                    found = Some((declaration, member));
                }
            }
        }
        found
    }

    // The member that a read names, with its enum and the declaration that it is written in.
    fn find_named_member(
        &self,
        file: FileId,
        access: ExprId,
    ) -> Option<(Sym, EnumId, EnumMemberId)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        if !hir.has_typescript_semantics() || !is_link_of_no_chain(hir, access) {
            return None;
        }
        let atoms = &self.files.atoms;
        let link = find_link_followed_by_transpiler(hir, access, |name| atoms.bytes(name));
        let (object, name) = link?;
        if !is_plain_read(hir, bound, access) {
            return None;
        }
        let enumeration = self.find_enum(file, object)?;
        let (declaration, member) = self.find_member(enumeration, name)?;
        Some((enumeration, declaration, member))
    }

    pub(crate) fn find_read(&self, file: FileId, access: ExprId) -> Option<MemberRead> {
        let named = self.find_named_member(file, access)?;
        let values = self.values_of((named.0.file, named.1, Named::OwnAndEarlier));
        self.read_member(file, access, named, &values)
    }

    /// The enums of other files that the values of the members of an enum rest on.
    pub(crate) fn enums_relied_on(&self, enumeration: Sym) -> SmallVec<[Sym; 2]> {
        let mut relied_on = SmallVec::new();
        let bound = self.files.bound(enumeration.file);
        for &declaration in bound.symbol(enumeration.id).decls {
            if let Decl::Enum(declaration) = declaration {
                let values = self.values_of((enumeration.file, declaration, Named::OwnAndEarlier));
                relied_on.extend_from_slice(&values.relies_on);
            }
        }
        relied_on
    }

    fn read_member(
        &self,
        file: FileId,
        access: ExprId,
        (enumeration, declaration, member): (Sym, EnumId, EnumMemberId),
        values: &DeclarationValues,
    ) -> Option<MemberRead> {
        let hir = self.files.hir(file);
        let declared_in = self.files.hir(enumeration.file);
        let index = (member.0 - declared_in[declaration].members.start) as usize;
        let MemberValue {
            value,
            is_known_to_build_alone,
        } = values.members[index]?;
        let is_in_place_of_reads = !is_known_to_build_alone;
        let validity = if enumeration.file == file {
            if !is_in_place_of_reads || !is_member_visited_before(hir, member, access) {
                return None;
            }
            Validity::Always
        } else if is_in_place_of_reads && declared_in[declaration].flags.contains(Flags::CONST) {
            Validity::Always
        } else if !self.graph.half(ModuleRef::File(file)) {
            Validity::WhileObjectIsNotHandedOn
        } else {
            return None;
        };
        Some(MemberRead {
            object: enumeration,
            value,
            validity,
        })
    }

    /// The enum, where the expression evaluates to its object and what takes the object only looks something up in it: `Color[key]`, `key in Color`, `for (key in Color)`.
    pub(crate) fn find_lookup(&self, file: FileId, object: ExprId) -> Option<Sym> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let (outermost, parent) = find_parent(hir, bound, object);
        let is_lookup = match parent {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    obj == outermost
                        && is_link_of_no_chain(hir, parent)
                        && is_plain_read(hir, bound, parent)
                }
                ExprKind::Binary {
                    op: BinOp::In,
                    right,
                    ..
                } => right == outermost,
                _ => false,
            },
            Parent::Stmt(parent) => {
                matches!(hir[parent].kind, StmtKind::ForIn { expr, .. } if expr == outermost)
            }
            _ => false,
        };
        match is_lookup {
            true => self.find_enum(file, object),
            false => None,
        }
    }

    pub(crate) fn is_data_module(&self, file: FileId) -> bool {
        self.graph.has_record(file)
            && self.graph.interop(ModuleRef::File(file)).kind == ModuleKind::Data
    }

    // Whatever names the module is a statement that links names to its variables, so whoever gets hold of its value does so through one of those.
    fn is_reached_through_variables_alone(&self, file: FileId) -> bool {
        self.is_data_module(file) && self.graph.is_data_linked_by_names_alone(file)
    }

    // The whole value of a module of data, such as a JSON file, where the variable holds it.
    fn find_data_in(&self, variable: Sym) -> Option<&'s DataValue<'s>> {
        if !self.is_data_module(variable.file) {
            return None;
        }
        let (hir, bound) = (
            self.files.hir(variable.file),
            self.files.bound(variable.file),
        );
        let BindingInitializer::Expression(initializer) =
            bound.binding_initializer(hir, variable.id)
        else {
            return None;
        };
        let decisions = &self.files.analysis(variable.file).decisions;
        match decisions.decision(initializer) {
            Decision::Data(data) => Some(data),
            _ => None,
        }
    }

    // The variable that a module of data exports as its value, where that is an object.
    fn find_variable_with_object(&self, file: FileId) -> Option<Sym> {
        let mut exports = self.graph.exports(file).iter();
        let ExportBinding::Variable(variable) = exports
            .find(|export| export.name == known::default)?
            .binding
        else {
            return None;
        };
        let holds_object =
            variable.file == file && matches!(self.find_data_in(variable)?, DataValue::Object(_));
        holds_object.then_some(variable)
    }

    /// The variable that holds the object of a module of data, where the build sees every way to the object.
    pub(crate) fn find_data_object(&self, file: FileId) -> Option<Sym> {
        match self.is_reached_through_variables_alone(file) {
            true => self.find_variable_with_object(file),
            false => None,
        }
    }

    /// The variable with the object of a module of data, where another variable of the module holds an object out of it: `import { nested } from "./data.json"`.
    pub(crate) fn find_data_object_shared_by(&self, variable: Sym) -> Option<Sym> {
        if !self.is_data_module(variable.file) {
            return None;
        }
        let object = self.find_data_object(variable.file)?;
        let holds_no_object = variable != object && self.find_data_variable(variable).is_some();
        (!holds_no_object).then_some(object)
    }

    /// What a variable of a module of data holds from before any code of the program runs, where that is no object: `import { version } from "./data.json"`.
    pub(crate) fn find_data_variable(&self, variable: Sym) -> Option<(Sym, Constant)> {
        let variable = self.follow_imports(variable)?;
        if !self.is_data_module(variable.file) {
            return None;
        }
        let (hir, bound) = (
            self.files.hir(variable.file),
            self.files.bound(variable.file),
        );
        let BindingInitializer::Expression(initializer) =
            bound.binding_initializer(hir, variable.id)
        else {
            return None;
        };
        let (_, value) = self.find_data_value(variable.file, initializer)?;
        Some((variable, value))
    }

    /// The variables that a module of data declares, with their declarators.
    pub(crate) fn data_variables(&self, file: FileId) -> impl Iterator<Item = (Sym, VarDeclId)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let declarators = (0..hir.var_decls.len() as u32).map(VarDeclId);
        declarators.map(move |declarator| {
            let id = bound.declared_symbol(Decl::Var(hir[declarator].pat));
            (Sym { file, id }, declarator)
        })
    }

    /// `data.version`, `data.nested.port`: a read by names, out of the object of a module of data, of a value that is no object.
    pub(crate) fn find_data_read(&self, file: FileId, access: ExprId) -> Option<MemberRead> {
        let (object, value) = self.find_data_value(file, access)?;
        let validity = Validity::WhileObjectIsNotHandedOn;
        (self.is_reached_through_variables_alone(object.file)).then_some(MemberRead {
            object,
            value,
            validity,
        })
    }

    // The variable with the object that the read starts at, and what the object is made with under the names.
    fn find_data_value(&self, file: FileId, access: ExprId) -> Option<(Sym, Constant)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut link = hir.skip_type_assertions(access);
        let root = loop {
            if !is_link_of_no_chain(hir, link) {
                return None;
            }
            let Some((object, MemberKey::Name(name))) = hir.member_key(link) else {
                return None;
            };
            names.push(name);
            link = hir.skip_type_assertions(object);
            if matches!(hir[link].kind, ExprKind::Ident(_)) {
                break link;
            }
        };
        let Binding::Symbol(id) = bound.binding(root) else {
            return None;
        };
        let object = self.follow_imports(Sym { file, id })?;
        if !self.is_data_module(object.file)
            || self.find_variable_with_object(object.file) != Some(object)
        {
            return None;
        }
        let mut value = self.find_data_in(object)?;
        for &name in names.iter().rev() {
            let DataValue::Object(entries) = *value else {
                return None;
            };
            // `Object.prototype` has an accessor of this name.
            if name == known::__proto__ {
                return None;
            }
            value = &entries.iter().find(|entry| entry.0 == name)?.1;
        }
        let Decision::Constant(value) = Decision::of_data(value) else {
            return None;
        };
        // Such a module has its value before any code of the program runs.
        is_plain_read(hir, bound, access).then_some((object, value))
    }

    /// To run such a declaration is to make the object and nothing else.
    pub(crate) fn knows_every_member(&self, file: FileId, declaration: EnumId) -> bool {
        let values = self.values_of((file, declaration, Named::OwnAndEarlier));
        values.members.iter().all(Option::is_some)
    }

    fn find_evaluated(&self, declaration: DeclarationKey) -> Option<MemberValues> {
        let by_declaration = self.known.by_declaration.borrow();
        by_declaration.get(&declaration).map(Rc::clone)
    }

    // What is known of a declaration hangs on the declaration alone, never on who asks first: a build asks in more than one order.
    // An enum may be made of an enum that is made of an enum, however often: what a declaration asks for is evaluated ahead of it.
    fn values_of(&self, declaration: DeclarationKey) -> MemberValues {
        let mut waiting: SmallVec<[DeclarationKey; 4]> = SmallVec::new();
        waiting.push(declaration);
        while let Some(&next) = waiting.last() {
            if self.find_evaluated(next).is_some() {
                waiting.pop();
                continue;
            }
            let evaluated = match self.compute_values(next) {
                Err(asked_for) if !waiting.contains(&asked_for) => {
                    waiting.push(asked_for);
                    continue;
                }
                // An initializer asks only for what has run before it, so no declaration comes to ask for itself.
                Err(_) => {
                    debug_assert!(false, "enums are made of each other");
                    DeclarationValues {
                        members: vec![None; self.files.hir(next.0)[next.1].members.len()].into(),
                        relies_on: Box::default(),
                    }
                }
                Ok(values) => values,
            };
            let mut by_declaration = self.known.by_declaration.borrow_mut();
            by_declaration.insert(next, Rc::new(evaluated));
        }
        match self.find_evaluated(declaration) {
            Some(values) => values,
            None => unreachable!("the loop ends when the declaration is evaluated"),
        }
    }

    fn compute_values(
        &self,
        (file, declaration, named): DeclarationKey,
    ) -> Result<DeclarationValues, DeclarationKey> {
        let hir = self.files.hir(file);
        let members = hir[declaration].members;
        let mut values: Vec<Option<MemberValue>> = Vec::with_capacity(members.len());
        // A member without an initializer is one more than the member before it, if that is a number.
        let mut counted = Some(0.0);
        let is_known_to_build_alone = Cell::new(false);
        let relies_on = RefCell::new(Vec::new());
        let asked_for = Cell::new(None);
        for member in members.iter() {
            let node = &hir[member];
            let value = if node.computed_name.is_some() {
                None
            } else if let Some(initializer) = node.init.some() {
                is_known_to_build_alone.set(false);
                let initializers = Initializers {
                    file,
                    declaration,
                    earlier: &values,
                    named,
                    is_known_to_build_alone: &is_known_to_build_alone,
                    relies_on: &relies_on,
                    asked_for: &asked_for,
                };
                let value = self.evaluate(initializers, initializer);
                if let Some(asked_for) = asked_for.take() {
                    return Err(asked_for);
                }
                value
            } else {
                counted.map(Constant::Number)
            };
            counted = match value {
                Some(Constant::Number(number)) => Some(number + 1.0),
                _ => None,
            };
            values.push(value.map(|value| MemberValue {
                value,
                is_known_to_build_alone: is_known_to_build_alone.get(),
            }));
        }
        Ok(DeclarationValues {
            members: values.into(),
            relies_on: relies_on.into_inner().into(),
        })
    }

    fn max_string_bytes(&self) -> usize {
        let max_string_bytes = self.limits.get(LimitId::MaxFoldedStringBytes);
        usize::try_from(max_string_bytes).unwrap_or(usize::MAX)
    }

    // The number or the string that an initializer evaluates to whenever it runs.
    fn evaluate(&self, initializers: Initializers<'_>, expression: ExprId) -> Option<Constant> {
        let hir = self.files.hir(initializers.file);
        let decisions = &self.files.analysis(initializers.file).decisions;
        let is_member_value =
            |value: &Constant| matches!(value, Constant::Number(_) | Constant::String(_));
        // `A | B | C | ..` leans to the left, however long it is.
        let mut right_operands: SmallVec<[(BinOp, ExprId); 8]> = SmallVec::new();
        let mut leftmost = hir.skip_type_assertions(expression);
        let mut value = loop {
            match (decisions.constant(hir, leftmost), hir[leftmost].kind) {
                (FoldedValue::Constant(constant), _) => break constant,
                (FoldedValue::ConstantOutsideDeadZone(_), _) => return None,
                (FoldedValue::Unknown, ExprKind::Binary { op, left, right }) => {
                    right_operands.push((op, right));
                    leftmost = hir.skip_type_assertions(left);
                }
                (FoldedValue::Unknown, _) => {
                    break self.evaluate_operand(initializers, leftmost)?;
                }
            }
        };
        let max_string_bytes = self.max_string_bytes();
        while let Some((op, right)) = right_operands.pop() {
            if !is_member_value(&value) {
                return None;
            }
            let operands = [value, self.evaluate(initializers, right)?];
            value = fold::apply_binary(&self.files.atoms, op, operands, max_string_bytes)?;
        }
        is_member_value(&value).then_some(value)
    }

    fn evaluate_operand(
        &self,
        initializers: Initializers<'_>,
        expression: ExprId,
    ) -> Option<Constant> {
        let Initializers {
            file,
            declaration,
            earlier,
            named,
            is_known_to_build_alone,
            relies_on,
            asked_for,
        } = initializers;
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let find_earlier = |member: EnumMemberId| {
            let index = (member.0 - hir[declaration].members.start) as usize;
            let earlier = earlier.get(index).copied().flatten()?;
            if earlier.is_known_to_build_alone {
                is_known_to_build_alone.set(true);
            }
            Some(earlier.value)
        };
        match hir[expression].kind {
            ExprKind::Unary { op, operand }
                if matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot) =>
            {
                let operand = self.evaluate(initializers, operand)?;
                fold::apply_unary(&self.files.atoms, op, operand)
            }
            ExprKind::Template { exprs } => {
                let mut substitutions: SmallVec<[Constant; 4]> = SmallVec::new();
                for substitution in hir.ids(exprs) {
                    substitutions.push(self.evaluate(initializers, substitution)?);
                }
                let texts: SmallVec<[Atom; 4]> = hir.ids(hir.template_texts(exprs)).collect();
                let max_string_bytes = self.max_string_bytes();
                fold::apply_template(&self.files.atoms, &texts, &substitutions, max_string_bytes)
            }
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(expression) else {
                    return None;
                };
                let [Decl::EnumMember(member)] = *bound.symbol(symbol).decls else {
                    return None;
                };
                if bound.enum_member_owner[member.idx()] != declaration {
                    return None;
                }
                find_earlier(member)
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. }
                if let Some((text, MemberKey::Name(name))) = hir.member_key(expression)
                    && name == known::length
                    && let Some(Constant::String(text)) = self.evaluate(initializers, text) =>
            {
                is_known_to_build_alone.set(true);
                let length = strings::wtf8_len_utf16(self.files.atoms.bytes(text));
                Some(Constant::Number(f64::from(length)))
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let found = self.find_named_member(file, expression)?;
                let (enumeration, owner, member) = found;
                if enumeration.file == file && owner == declaration {
                    return find_earlier(member);
                }
                if named == Named::Own {
                    return None;
                }
                // The other declaration stands further up in the file, or in a file that has run. A file on a cycle reads a `const enum` of
                // another file all the same: of that one the members count that name none but their own.
                let has_run_before = match enumeration.file == file {
                    true => is_member_visited_before(hir, member, expression),
                    false => !self.graph.half(ModuleRef::File(file)),
                };
                let other = match has_run_before {
                    true => (enumeration.file, owner, Named::OwnAndEarlier),
                    false if enumeration.file == file => return None,
                    false => (enumeration.file, owner, Named::Own),
                };
                let Some(values) = self.find_evaluated(other) else {
                    asked_for.set(Some(other));
                    return None;
                };
                let read = self.read_member(file, expression, found, &values)?;
                if read.validity == Validity::WhileObjectIsNotHandedOn {
                    is_known_to_build_alone.set(true);
                    let mut relies_on = relies_on.borrow_mut();
                    for &relied_on in [enumeration].iter().chain(values.relies_on.iter()) {
                        if !relies_on.contains(&relied_on) {
                            relies_on.push(relied_on);
                        }
                    }
                }
                Some(read.value)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests;
mod unused;

use core::cell::RefCell;

use bun_core::StackCheck;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingStability, Bound, CodeUnit, CommonJsVariable, Decl, ModuleInstanceState,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ClassId, EnumId, EnumMemberId, ExprId, ExprKind, Flags, FnBody,
    ImportEqualsId, ImportEqualsTarget, JsxId, MemberId, MemberKey, MemberKind, ModifierId,
    ModifierKind, ModuleId, ModuleName, NameKind, NodeData, PatId, PatKind, PropId, PropKey,
    PropKind, Span, StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{FileId, Files};
use rustc_hash::FxHashMap;

use crate::builtins::table::{self, BuiltinFlags};
use crate::builtins::{BuiltinId, BuiltinKind, Resolved, ResolvedBuiltins};
use crate::load::sources::parsed_source;
use crate::modules::{Member, ModuleGraph};
use crate::options::RemovableOptions;

// `known_primitive` of src/ast/expr.rs.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Primitive {
    Unknown,
    Mixed,
    Null,
    Undefined,
    Boolean,
    Number,
    String,
    BigInt,
}

impl Primitive {
    fn of_constant(constant: Constant) -> Primitive {
        match constant {
            Constant::Undefined => Primitive::Undefined,
            Constant::Null => Primitive::Null,
            Constant::Boolean(_) => Primitive::Boolean,
            Constant::Number(_) => Primitive::Number,
            Constant::String(_) => Primitive::String,
            Constant::BigInt(_) => Primitive::BigInt,
        }
    }

    fn merge(self, other: Primitive) -> Primitive {
        if self == Primitive::Unknown || other == Primitive::Unknown {
            Primitive::Unknown
        } else if self == other {
            self
        } else {
            Primitive::Mixed
        }
    }

    fn is_one_kind(self) -> bool {
        !matches!(self, Primitive::Unknown | Primitive::Mixed)
    }
}

// The table says what the value is, so no getter of the program or of the host stands behind the name.
fn is_read_without_code(builtin: BuiltinId, is_global: bool) -> bool {
    let entry = table::entry(builtin);
    match entry.kind {
        BuiltinKind::DataProperty => {
            is_global && entry.flags.contains(BuiltinFlags::IS_LAZILY_CREATED)
        }
        BuiltinKind::Accessor | BuiltinKind::NativeBinding => false,
        _ => is_global || !entry.flags.contains(BuiltinFlags::IS_LAZILY_CREATED),
    }
}

fn is_arithmetic(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor
    )
}

// A key that the bundler's parser holds as a string and does not mark as computed: `a`, `"a"`.
fn find_written_name(key: PropKey, name_kind: NameKind) -> Option<Atom> {
    let is_written_name = matches!(name_kind, NameKind::Identifier | NameKind::StringLiteral);
    match key {
        PropKey::Name(name) if is_written_name => Some(name),
        PropKey::Name(_) | PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
    }
}

// Whether evaluating a piece of a file's top level can be left out when nothing uses what it declares, by the rules of src/js_parser/p.rs.
pub(crate) struct Removable<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub builtins: &'a ResolvedBuiltins,
    pub atoms: &'a Interner<'s>,
    pub options: RemovableOptions,
    modules: Option<(&'a ModuleGraph, FileId)>,
    stack: StackCheck,
    member_constants: RefCell<FxHashMap<EnumMemberId, Option<Primitive>>>,
}

impl<'a, 's> Removable<'a, 's> {
    // For the thread that calls it: the limit of the stack is that thread's.
    pub(crate) fn new(
        files: &'a Files<'s>,
        file: FileId,
        options: RemovableOptions,
    ) -> Option<Removable<'a, 's>> {
        let (builtins, analysis) = (&parsed_source(files, file)?.builtins, files.analysis(file));
        Some(Removable::of_file(files, file, analysis, builtins, options))
    }

    pub(crate) fn of_file(
        files: &'a Files<'s>,
        file: FileId,
        analysis: &'a FileAnalysis<'s>,
        builtins: &'a ResolvedBuiltins,
        options: RemovableOptions,
    ) -> Removable<'a, 's> {
        Removable {
            hir: files.hir(file),
            bound: files.bound(file),
            analysis,
            builtins,
            atoms: &files.atoms,
            options,
            modules: None,
            stack: StackCheck::init(),
            member_constants: RefCell::default(),
        }
    }

    // `const a = require("./module.mjs")`: with the graph, `a.name` is what it is under `import * as a`.
    pub(crate) fn with_modules(self, modules: &'a ModuleGraph, file: FileId) -> Removable<'a, 's> {
        Removable {
            modules: Some((modules, file)),
            ..self
        }
    }

    // An import, and an export from another module, answer for themselves alone: whether the other module is evaluated is the caller's question.
    pub(crate) fn statement(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        if self.never_runs(statement) || hir.is_erased_statement(statement) {
            return true;
        }
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        match hir[statement].kind {
            StmtKind::Empty
            | StmtKind::Directive { .. }
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_) => true,
            StmtKind::Expr(expression) | StmtKind::ExportDefault(expression) => {
                self.expression(expression)
            }
            StmtKind::Var(declarations) => declarations.iter().all(|it| self.declaration(it)),
            StmtKind::Class(class) => self.class(class),
            StmtKind::Enum(declaration) => self.enumeration(declaration),
            StmtKind::Module(namespace) => self.is_namespace_without_code(namespace),
            StmtKind::ImportEquals(alias) => self.import_equals(alias),
            StmtKind::If { test, yes, no } => {
                self.expression(test) && self.never_runs(yes) && self.never_runs(no)
            }
            StmtKind::Try {
                block, finalizer, ..
            } => self.enclosed_block(block) && self.enclosed_block(finalizer),
            StmtKind::ExportStar { type_only, .. } => type_only,
            _ => false,
        }
    }

    // The bundler makes a part of each declaration of a statement.
    pub(crate) fn declaration(&self, declaration: VarDeclId) -> bool {
        let node = &self.hir[declaration];
        if node.flags.contains(Flags::AMBIENT) {
            return true;
        }
        let disposes_nothing = match node.kind {
            VarKind::Var | VarKind::Let | VarKind::Const => true,
            VarKind::Using => {
                let value = node.init.some().and_then(|value| self.literal(value));
                node.init.is_none() || matches!(value, Some(Primitive::Null | Primitive::Undefined))
            }
            VarKind::AwaitUsing => false,
        };
        disposes_nothing && self.pattern(node.pat, node.init) && self.expression(node.init)
    }

    // A pattern reads properties of its value or runs its iterator. `value` is `NONE` where there is none.
    pub(crate) fn pattern(&self, pattern: PatId, value: ExprId) -> bool {
        let hir = self.hir;
        let literal = value
            .some()
            .map(|value| hir[hir.skip_type_assertions(value)].kind);
        match hir[pattern].kind {
            PatKind::Missing => true,
            PatKind::Ident(_) => self
                .bound
                .dynamic_lookup_scope(NodeData::Pat(pattern))
                .is_none(),
            PatKind::Array(elements) => {
                matches!(literal, Some(ExprKind::Array(_)))
                    && elements.iter().all(|element| {
                        let element = &hir[element];
                        let binds_a_name = match hir[element.pat].kind {
                            PatKind::Missing | PatKind::Ident(_) => true,
                            PatKind::Object(_) | PatKind::Array(_) => false,
                        };
                        binds_a_name && self.expression(element.default)
                    })
            }
            PatKind::Object(properties) => {
                let Some(ExprKind::Object(written)) = literal else {
                    return false;
                };
                self.stack.is_safe_to_recurse()
                    && written.iter().all(|property| self.has_plain_key(property))
                    && properties.iter().all(|property| {
                        let property = &hir[property];
                        let name = find_written_name(property.key, property.name_kind);
                        let read = name.and_then(|name| self.find_data_property(written, name));
                        !property.is_rest
                            && self.expression(property.default)
                            && read.is_some_and(|read| self.pattern(property.value, read))
                    })
            }
        }
    }

    pub(crate) fn class(&self, class: ClassId) -> bool {
        let node = &self.hir[class];
        node.flags.contains(Flags::AMBIENT)
            || (!self.has_decorator(node.modifiers)
                && node.other_extends.is_empty()
                && self.expression(node.extends)
                && node.members.iter().all(|member| self.member(member)))
    }

    pub(crate) fn expression(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let decisions = &self.analysis.decisions;
        if expression.is_none() || decisions.is_dead_expr(expression) {
            return true;
        }
        match decisions.decision(expression) {
            Decision::Constant(_) | Decision::Data(_) => return true,
            Decision::GlobalPath(_) | Decision::DeferredData => return false,
            Decision::Unknown => {}
        }
        if self.find_constant(expression).is_some() {
            return true;
        }
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        match hir[expression].kind {
            ExprKind::Ident(_) => self.identifier(expression),
            ExprKind::Template { exprs } => hir.ids(exprs).all(|substitution| {
                self.expression(substitution) && self.primitive(substitution) != Primitive::Unknown
            }),
            ExprKind::Array(items) => hir
                .ids(items)
                .all(|item| self.expression(item) || self.is_spread_of_removable_literal(item)),
            ExprKind::Object(properties) => {
                properties.iter().all(|property| self.property(property))
            }
            ExprKind::Class(class) => self.class(class),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.member_read(expression),
            ExprKind::Call(call) | ExprKind::New(call) => {
                let is_construction = matches!(hir[expression].kind, ExprKind::New(_));
                let call = &hir[call];
                let is_marked = call.is_pure && !self.options.ignores_pure_annotations;
                (is_marked || (is_construction && self.constructs_without_effects(call)))
                    && self.analysis.import_site_of_call(expression).is_none()
                    && hir.ids(call.args).all(|argument| self.expression(argument))
            }
            ExprKind::Unary { op, operand } => self.unary(op, operand),
            ExprKind::Binary { op, left, right } => self.binary(op, left, right),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let is_removable = |branch: ExprId, is_yes_branch: bool| {
                    self.is_guarded_free_name(branch, test, is_yes_branch)
                        || self.expression(branch)
                };
                self.expression(test)
                    && is_removable(branches.yes, true)
                    && is_removable(branches.no, false)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.expression(expr),
            ExprKind::Jsx(element) => self.jsx(element),
            ExprKind::PrivateIdentifier(_)
            | ExprKind::Super
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Assign { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::ImportCall { .. }
            | ExprKind::NewTarget(_) => false,
            _ => true,
        }
    }

    // `[...[a, b]]`: under --minify-syntax the bundler's visitor puts the elements in the place of the spread.
    fn is_spread_of_removable_literal(&self, item: ExprId) -> bool {
        let ExprKind::Spread(spread) = self.hir[item].kind else {
            return false;
        };
        let spread = self.hir.skip_type_assertions(spread);
        self.options.minifies_syntax
            && matches!(self.hir[spread].kind, ExprKind::Array(_))
            && self.stack.is_safe_to_recurse()
            && self.expression(spread)
    }

    // `minify_global_constructor` of src/ast/known_global.rs, which the bundler's visitor asks under --minify-syntax. The arguments are judged by the caller.
    fn constructs_without_effects(&self, call: &hir::Call) -> bool {
        let hir = self.hir;
        let callee = hir.skip_type_assertions(call.callee);
        if !self.options.minifies_syntax || self.find_static_binding(callee) != Some(Binding::Free)
        {
            return false;
        }
        let Some(constructor) = self.builtins.builtin_of_expression(callee) else {
            return false;
        };
        let mut arguments = hir.ids(call.args);
        let (Some(argument), None) = (arguments.next(), arguments.next()) else {
            return call.args.is_empty()
                && matches!(
                    constructor,
                    BuiltinId::Map
                        | BuiltinId::Set
                        | BuiltinId::WeakMap
                        | BuiltinId::WeakSet
                        | BuiltinId::Date
                );
        };
        let argument = hir.skip_type_assertions(argument);
        let is_nullish = matches!(
            self.literal(argument),
            Some(Primitive::Null | Primitive::Undefined)
        ) || matches!(hir[argument].kind, ExprKind::Null);
        let elements = match hir[argument].kind {
            ExprKind::Array(elements) => Some(elements),
            _ => None,
        };
        match constructor {
            BuiltinId::Set => is_nullish || elements.is_some(),
            BuiltinId::Map => {
                is_nullish
                    || elements.is_some_and(|elements| {
                        hir.ids(elements).all(|element| {
                            let element = hir.skip_type_assertions(element);
                            matches!(hir[element].kind, ExprKind::Array(_))
                        })
                    })
            }
            BuiltinId::WeakMap | BuiltinId::WeakSet => {
                is_nullish || elements.is_some_and(|elements| elements.is_empty())
            }
            BuiltinId::Date => matches!(
                self.primitive(argument),
                Primitive::Null
                    | Primitive::Undefined
                    | Primitive::Boolean
                    | Primitive::Number
                    | Primitive::String
            ),
            _ => false,
        }
    }

    fn never_runs(&self, statement: StmtId) -> bool {
        statement.is_none() || self.analysis.decisions.is_dead_stmt(statement)
    }

    // A `var` and a function of a block are also bindings of the code around it, which this answer says nothing about.
    fn enclosed_block(&self, block: StmtId) -> bool {
        let hir = self.hir;
        if self.never_runs(block) {
            return true;
        }
        let StmtKind::Block(statements) = hir[block].kind else {
            return false;
        };
        hir.ids(statements).all(|statement| {
            let kind = hir[statement].kind;
            let stays_inside = if let StmtKind::Var(declarations) = kind {
                declarations
                    .iter()
                    .all(|declaration| hir[declaration].kind != VarKind::Var)
            } else {
                matches!(
                    kind,
                    StmtKind::Empty | StmtKind::Expr(_) | StmtKind::Class(_) | StmtKind::Try { .. }
                )
            };
            stays_inside && self.statement(statement)
        })
    }

    fn enumeration(&self, declaration: EnumId) -> bool {
        let hir = self.hir;
        hir[declaration].members.iter().all(|member| {
            let node = &hir[member];
            node.computed_name.is_none()
                && (self.member_constant(member).is_some() || self.expression(node.init))
        })
    }

    fn is_namespace_without_code(&self, namespace: ModuleId) -> bool {
        let node = &self.hir[namespace];
        match node.name {
            ModuleName::String(_) | ModuleName::Global => true,
            ModuleName::Ident(_) => match self.bound.module_instance_state[namespace.idx()] {
                ModuleInstanceState::NonInstantiated => true,
                ModuleInstanceState::Instantiated | ModuleInstanceState::ConstEnumOnly => {
                    node.flags.contains(Flags::AMBIENT)
                }
            },
        }
    }

    fn import_equals(&self, alias: ImportEqualsId) -> bool {
        let node = &self.hir[alias];
        if node.flags.intersects(Flags::TYPE_ONLY | Flags::AMBIENT) {
            return true;
        }
        match node.target {
            ImportEqualsTarget::Require(_) => false,
            ImportEqualsTarget::Entity(names) => {
                let is_name_of_file = match self.bound.entity_root_binding(alias) {
                    Binding::Symbol(symbol) => {
                        self.bound.binding_stability(symbol) != BindingStability::ContainerMember
                    }
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
                };
                !node.flags.contains(Flags::EXPORT) || (names.len() == 1 && is_name_of_file)
            }
        }
    }

    fn has_decorator(&self, modifiers: Span<ModifierId>) -> bool {
        modifiers
            .iter()
            .any(|modifier| match self.hir[modifier].kind {
                ModifierKind::Decorator(_) => true,
                ModifierKind::Keyword(_) => false,
            })
    }

    fn member(&self, member: MemberId) -> bool {
        let hir = self.hir;
        if !hir::has_runtime_member(hir, member) {
            return true;
        }
        let node = &hir[member];
        let has_plain_key = match node.key {
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => true,
            PropKey::Computed(key) => {
                let key = hir.skip_type_assertions(key);
                let is_reference =
                    matches!(hir[key].kind, ExprKind::Ident(_) | ExprKind::Dot { .. });
                self.literal(key).is_some() || (is_reference && self.expression(key))
            }
        };
        if !has_plain_key
            || self.has_decorator(node.modifiers)
            || node.flags.contains(Flags::ACCESSOR)
        {
            return false;
        }
        match node.kind {
            MemberKind::Property => {
                !node.flags.contains(Flags::STATIC) || self.expression(node.init)
            }
            MemberKind::StaticBlock => match node.func.some().map(|block| hir[block].body) {
                Some(FnBody::Block(statements)) => hir
                    .ids(statements)
                    .all(|statement| self.statement(statement)),
                Some(FnBody::None | FnBody::Expr(_)) | None => false,
            },
            MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => true,
            _ => {
                let mut parameters = hir[node.func].params.iter();
                parameters.all(|parameter| !self.has_decorator(hir.param_modifiers(parameter)))
            }
        }
    }

    fn property(&self, property: PropId) -> bool {
        let node = &self.hir[property];
        let has_plain_key = match node.key {
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => true,
            PropKey::Computed(key) => self.literal(key).is_some(),
        };
        let copies_nothing = !matches!(node.kind, PropKind::Spread);
        has_plain_key && copies_nothing && self.expression(node.value)
    }

    fn has_plain_key(&self, property: PropId) -> bool {
        let node = &self.hir[property];
        let name = find_written_name(node.key, node.name_kind);
        node.kind != PropKind::Spread && name.is_some_and(|name| name != known::__proto__)
    }

    // The last of several properties with one name counts.
    fn find_data_property(&self, properties: Span<PropId>, name: Atom) -> Option<ExprId> {
        let mut nodes = properties.iter().rev().map(|property| &self.hir[property]);
        let node = nodes.find(|node| find_written_name(node.key, node.name_kind) == Some(name))?;
        match node.kind {
            PropKind::Init | PropKind::Shorthand | PropKind::Method => Some(node.value),
            PropKind::Getter | PropKind::Setter | PropKind::Spread => None,
        }
    }

    fn jsx(&self, element: JsxId) -> bool {
        let hir = self.hir;
        let node = &hir[element];
        !self.options.ignores_pure_annotations
            && !self.options.jsx_has_side_effects
            && self.expression(node.tag)
            && node.attrs.iter().all(|attribute| self.property(attribute))
            && hir.ids(node.children).all(|child| self.expression(child))
    }

    fn unary(&self, op: UnOp, operand: ExprId) -> bool {
        match op {
            UnOp::Void | UnOp::Not => self.expression(operand),
            UnOp::Typeof => {
                let name = self.hir.skip_type_assertions(operand);
                self.find_static_binding(name).is_some() || self.expression(operand)
            }
            UnOp::Plus | UnOp::Minus => self.has_folded_sign(operand),
            _ => false,
        }
    }

    fn binary(&self, op: BinOp, left: ExprId, right: ExprId) -> bool {
        let converts_nothing = match op {
            BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::Comma
            | BinOp::Nullish
            | BinOp::Or
            | BinOp::And => true,
            BinOp::EqEq | BinOp::NotEq => {
                let kind = self.primitive(left);
                kind.is_one_kind() && kind == self.primitive(right)
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let kind = self.primitive(left);
                matches!(
                    kind,
                    Primitive::String | Primitive::Number | Primitive::BigInt
                ) && kind == self.primitive(right)
            }
            _ => false,
        };
        let is_guarded = matches!(op, BinOp::Or | BinOp::And)
            && self.is_guarded_free_name(right, left, op == BinOp::And);
        converts_nothing && self.expression(left) && (is_guarded || self.expression(right))
    }

    fn identifier(&self, identifier: ExprId) -> bool {
        if !self.bound.is_evaluated_ident(identifier) {
            return true;
        }
        match self.find_static_binding(identifier) {
            Some(Binding::Symbol(symbol)) => {
                self.bound.binding_stability(symbol) != BindingStability::ContainerMember
                    || self.inlined_member(identifier).is_some()
            }
            Some(Binding::Arguments(unit)) => match unit {
                CodeUnit::Function(_) => true,
                CodeUnit::File | CodeUnit::FieldInitializer(_) => false,
            },
            Some(Binding::CommonJs(variable)) => match variable {
                CommonJsVariable::Module | CommonJsVariable::Exports => {
                    self.analysis.module_format == ModuleFormat::CommonJs
                }
                _ => false,
            },
            Some(Binding::Free) => self.is_builtin_read(identifier),
            None => false,
        }
    }

    // The binding of a name that is evaluated and that no `with` and no `eval` can bind anew.
    fn find_static_binding(&self, name: ExprId) -> Option<Binding> {
        let is_static = matches!(self.hir[name].kind, ExprKind::Ident(_))
            && self.bound.is_evaluated_ident(name)
            && self
                .bound
                .dynamic_lookup_scope(NodeData::Expr(name))
                .is_none();
        is_static.then(|| self.bound.binding(name))
    }

    fn find_free_name(&self, expression: ExprId) -> Option<Atom> {
        let name = self.hir.skip_type_assertions(expression);
        let ExprKind::Ident(text) = self.hir[name].kind else {
            return None;
        };
        (self.find_static_binding(name) == Some(Binding::Free)).then_some(text)
    }

    // `a.b` and `a["b"]` outside an optional chain: `a` without its casts.
    fn find_link(&self, expression: ExprId) -> Option<(ExprId, Atom)> {
        let hir = self.hir;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[expression].kind
        else {
            return None;
        };
        match hir.member_key(expression)? {
            (object, MemberKey::Name(name)) if chain == Chain::No => {
                Some((hir.skip_type_assertions(object), name))
            }
            (_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)) => None,
        }
    }

    fn member_read(&self, expression: ExprId) -> bool {
        let Some((object, _)) = self.find_link(expression) else {
            return false;
        };
        if matches!(self.hir[object].kind, ExprKind::ImportMeta) {
            let property = self.builtins.builtin_of_expression(expression);
            return !matches!(
                property,
                Some(BuiltinId::ImportMetaMain | BuiltinId::ImportMetaHot)
            );
        }
        let is_export_of_namespace = match self.find_static_binding(object) {
            Some(Binding::Symbol(symbol)) => {
                matches!(*self.bound.symbol(symbol).decls, [Decl::ImportNamespace(_)])
            }
            Some(Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free) | None => false,
        };
        is_export_of_namespace
            || self.is_bound_to_binding(expression, object)
            || self.inlined_member(expression).is_some()
            || self.is_builtin_read(expression)
    }

    // The read of a binding of another module, whatever becomes of the object that the member is written on.
    fn is_bound_to_binding(&self, member: ExprId, object: ExprId) -> bool {
        matches!(self.hir[object].kind, ExprKind::Ident(_))
            && self.modules.is_some_and(|(modules, file)| {
                matches!(modules.member(file, member), Some(Member::Binding(_)))
            })
    }

    // A free name, or a path of names from one, that the table of built-ins knows at every step.
    fn is_builtin_read(&self, expression: ExprId) -> bool {
        let Some(Resolved::Builtin(path)) = self.builtins.of_expr(expression) else {
            return false;
        };
        match self.find_link(expression) {
            Some((object, _)) => {
                self.stack.is_safe_to_recurse()
                    && is_read_without_code(path.id, false)
                    && self.is_builtin_read(object)
            }
            None => {
                self.find_static_binding(expression) == Some(Binding::Free)
                    && is_read_without_code(path.id, true)
            }
        }
    }

    // `typeof a !== "undefined" && a`, `typeof a < "u" ? a : b`: the name is read only where it is known to exist.
    fn is_guarded_free_name(&self, value: ExprId, guard: ExprId, is_yes_branch: bool) -> bool {
        let hir = self.hir;
        let Some(name) = self.find_free_name(value) else {
            return false;
        };
        let ExprKind::Binary { op, left, right } = hir[hir.skip_type_assertions(guard)].kind else {
            return false;
        };
        let (tested, text, is_flipped) = match self.find_string(left) {
            Some(text) => (right, text, true),
            None => match self.find_string(right) {
                Some(text) => (left, text, false),
                None => return false,
            },
        };
        let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = hir[hir.skip_type_assertions(tested)].kind
        else {
            return false;
        };
        if self.find_free_name(operand) != Some(name) {
            return false;
        }
        let is_undefined = text == known::undefined;
        let is_before_undefined = self.atoms.bytes(text) == b"u";
        match op {
            BinOp::EqEqEq | BinOp::EqEq => is_undefined != is_yes_branch,
            BinOp::NotEqEq | BinOp::NotEq => is_undefined == is_yes_branch,
            BinOp::Lt | BinOp::Le => is_before_undefined && is_yes_branch != is_flipped,
            BinOp::Gt | BinOp::Ge => is_before_undefined && is_yes_branch == is_flipped,
            _ => false,
        }
    }

    fn find_string(&self, expression: ExprId) -> Option<Atom> {
        match self.find_constant(self.hir.skip_type_assertions(expression)) {
            Some(Constant::String(text)) => Some(text),
            Some(
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::Number(_)
                | Constant::BigInt(_),
            )
            | None => None,
        }
    }

    // The bundler ignores the dead zone of a binding.
    fn find_constant(&self, expression: ExprId) -> Option<Constant> {
        match self.analysis.decisions.constant(self.hir, expression) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        }
    }

    // What stands for the expression is a literal: `is_primitive_literal` of the bundler's folded tree.
    fn literal(&self, expression: ExprId) -> Option<Primitive> {
        let expression = self.hir.skip_type_assertions(expression);
        if let Some(constant) = self.find_constant(expression) {
            return Some(Primitive::of_constant(constant));
        }
        if self.find_static_binding(expression) == Some(Binding::Free) {
            return match self.builtins.builtin_of_expression(expression)? {
                BuiltinId::Undefined => Some(Primitive::Undefined),
                BuiltinId::NaN | BuiltinId::Infinity => Some(Primitive::Number),
                _ => None,
            };
        }
        if let ExprKind::Unary { op, operand } = self.hir[expression].kind
            && matches!(op, UnOp::Plus | UnOp::Minus)
        {
            return self.has_folded_sign(operand).then_some(Primitive::Number);
        }
        self.inlined_member(expression)
    }

    // `to_number` of src/ast/expr.rs: the bundler's visitor folds `+` and `-` in front of these.
    fn has_folded_sign(&self, operand: ExprId) -> bool {
        let literal = match self.stack.is_safe_to_recurse() {
            true => self.literal(operand),
            false => None,
        };
        match literal {
            Some(
                Primitive::Null
                | Primitive::Undefined
                | Primitive::Boolean
                | Primitive::Number
                | Primitive::String,
            ) => true,
            Some(Primitive::BigInt | Primitive::Unknown | Primitive::Mixed) | None => false,
        }
    }

    // The bundler's parser puts the value in place of a member of an enum that it has visited, and it visits the enums of a file, in their order, before the other statements.
    fn inlined_member(&self, reference: ExprId) -> Option<Primitive> {
        let hir = self.hir;
        let member = self.find_enum_member(reference)?;
        let position = hir[reference].pos;
        let is_visited_before = hir[member].loc.end <= position
            || hir.enums.iter().all(|declaration| {
                let written_at = hir[declaration.stmt].loc;
                !(written_at.pos..written_at.end).contains(&position)
            });
        is_visited_before
            .then(|| self.member_constant(member))
            .flatten()
    }

    fn find_enum_member(&self, reference: ExprId) -> Option<EnumMemberId> {
        let (hir, bound) = (self.hir, self.bound);
        let symbol_of = |name: ExprId| match self.find_static_binding(name) {
            Some(Binding::Symbol(symbol)) => Some(bound.symbol(symbol)),
            Some(Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free) | None => None,
        };
        let Some((object, name)) = self.find_link(reference) else {
            return match *symbol_of(reference)?.decls {
                [Decl::EnumMember(member)] => Some(member),
                _ => None,
            };
        };
        let mut found = None;
        for &declaration in symbol_of(object)?.decls {
            let Decl::Enum(declaration) = declaration else {
                return None;
            };
            let mut members = hir[declaration].members.iter();
            found = found.or_else(|| members.find(|&member| hir[member].name == name));
        }
        found
    }

    fn member_constant(&self, member: EnumMemberId) -> Option<Primitive> {
        if let Some(&constant) = self.member_constants.borrow().get(&member) {
            return constant;
        }
        let constant = match self.stack.is_safe_to_recurse() {
            true => self.compute_member_constant(member),
            false => None,
        };
        self.member_constants.borrow_mut().insert(member, constant);
        constant
    }

    // A member without an initializer is one more than the member before it, if that is a number.
    fn compute_member_constant(&self, member: EnumMemberId) -> Option<Primitive> {
        let hir = self.hir;
        let mut declarations = hir.enums.iter();
        let declaration = declarations.find(|it| it.members.range().contains(&member.idx()))?;
        let mut counted_from = member;
        loop {
            let node = &hir[counted_from];
            if node.computed_name.is_some() {
                return None;
            }
            if let Some(initializer) = node.init.some() {
                let constant = self.enum_constant(initializer)?;
                let is_counted = counted_from == member || constant == Primitive::Number;
                return is_counted.then_some(constant);
            }
            if counted_from.0 == declaration.members.start {
                return Some(Primitive::Number);
            }
            counted_from = EnumMemberId(counted_from.0 - 1);
        }
    }

    // The number or the string that the bundler's parser folds an initializer of an enum to.
    fn enum_constant(&self, initializer: ExprId) -> Option<Primitive> {
        let hir = self.hir;
        let initializer = hir.skip_type_assertions(initializer);
        if let Some(literal) = self.literal(initializer) {
            return matches!(literal, Primitive::Number | Primitive::String).then_some(literal);
        }
        if !self.stack.is_safe_to_recurse() {
            return None;
        }
        let is_number = |operand: ExprId| self.enum_constant(operand) == Some(Primitive::Number);
        let is_folded = if let ExprKind::Unary { op, operand } = hir[initializer].kind {
            matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot) && is_number(operand)
        } else if let ExprKind::Binary { op, left, right } = hir[initializer].kind {
            is_arithmetic(op) && is_number(left) && is_number(right)
        } else {
            false
        };
        is_folded.then_some(Primitive::Number)
    }

    fn primitive_of_either(&self, first: ExprId, second: ExprId) -> Primitive {
        let decisions = &self.analysis.decisions;
        match (
            decisions.is_dead_expr(first),
            decisions.is_dead_expr(second),
        ) {
            (true, _) => self.primitive(second),
            (false, true) => self.primitive(first),
            (false, false) => self.primitive(first).merge(self.primitive(second)),
        }
    }

    fn primitive(&self, expression: ExprId) -> Primitive {
        let hir = self.hir;
        let expression = hir.skip_type_assertions(expression);
        if let Some(literal) = self.literal(expression) {
            return literal;
        }
        if !self.stack.is_safe_to_recurse() {
            return Primitive::Unknown;
        }
        match hir[expression].kind {
            ExprKind::Null => Primitive::Null,
            ExprKind::True | ExprKind::False => Primitive::Boolean,
            ExprKind::Number(_) => Primitive::Number,
            ExprKind::BigInt(_) => Primitive::BigInt,
            ExprKind::String(_) | ExprKind::Template { .. } | ExprKind::JsxText(_) => {
                Primitive::String
            }
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                self.primitive_of_either(branches.yes, branches.no)
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void => Primitive::Undefined,
                UnOp::Typeof => Primitive::String,
                UnOp::Not | UnOp::Delete => Primitive::Boolean,
                UnOp::Plus => Primitive::Number,
                UnOp::Minus | UnOp::BitNot => match self.primitive(operand) {
                    Primitive::BigInt => Primitive::BigInt,
                    Primitive::Unknown | Primitive::Mixed => Primitive::Mixed,
                    _ => Primitive::Number,
                },
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Primitive::Mixed,
            },
            ExprKind::Binary { op, left, right } => self.primitive_of_binary(op, left, right),
            _ => Primitive::Unknown,
        }
    }

    fn primitive_of_binary(&self, op: BinOp, left: ExprId, right: ExprId) -> Primitive {
        match op {
            BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::In
            | BinOp::Instanceof => Primitive::Boolean,
            BinOp::And | BinOp::Or => self.primitive_of_either(left, right),
            BinOp::Nullish if self.analysis.decisions.is_dead_expr(right) => self.primitive(left),
            BinOp::Nullish => match (self.primitive(left), self.primitive(right)) {
                (Primitive::Null | Primitive::Undefined, right) => right,
                (Primitive::Unknown, _) | (Primitive::Mixed, Primitive::Unknown) => {
                    Primitive::Unknown
                }
                (Primitive::Mixed, _) => Primitive::Mixed,
                (left, _) => left,
            },
            BinOp::Add => match (self.primitive(left), self.primitive(right)) {
                (Primitive::String, _) | (_, Primitive::String) => Primitive::String,
                (Primitive::BigInt, _) | (_, Primitive::BigInt) => Primitive::BigInt,
                (left, right) if left.is_one_kind() && right.is_one_kind() => Primitive::Number,
                _ => Primitive::Mixed,
            },
            BinOp::Comma => self.primitive(right),
            _ => Primitive::Mixed,
        }
    }
}

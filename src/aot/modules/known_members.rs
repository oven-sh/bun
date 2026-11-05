use core::cell::{Cell, RefCell, RefMut};
use core::ops::Range;

use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Bound, Decl, Parent, SymbolId};
use bun_sema::check::aot::{
    find_link_followed_by_transpiler, find_member_followed_by_transpiler, is_member_visited_before,
};
use bun_sema::fold::{self, Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, EnumId, EnumMemberId, ExprId, ExprKind, Flags, MemberKey, StmtKind, UnOp,
    VarDeclId,
};
use bun_sema::hir_from_data::DataValue;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files, Sym};
use smallvec::SmallVec;

use super::graph::{FileRow, StoredSiteAnswer};
use super::{
    ExportBinding, ImportBinding, ImportPhase, Member, ModuleGraph, ModuleKind, ModuleRef,
};
use crate::ir::classify_name;
use crate::ir::generated::NameClass;
use crate::load::fold_inputs::MAX_FOLDED_STRING_BYTES;

#[cfg(test)]
mod tests;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Validity {
    /// `bun build` has the value in the place of the read too.
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

// Which members an initializer may name for its value to be known.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Named {
    // Those of its own declaration, and those of the declarations that have run before it.
    OwnAndEarlier,
    Own,
}

type DeclarationKey = (FileId, EnumId, Named);

struct DeclarationValues {
    members: Vec<Option<MemberValue>>,
    relies_on: Vec<Sym>,
    // A member also stores its name under what it holds, unless it is written as a string: `E[E["X"] = f()] = "X"` stores over the member `A` where `f()` answers "A".
    // The text of a number is no name that `list_members_by_name` lists.
    may_store_over_members: bool,
}

// Where `KnownMemberValues::values` and `relied_on` hold what is known of a declaration.
#[derive(Copy, Clone)]
struct Evaluated {
    first_value: u32,
    value_count: u32,
    first_relied_on: u32,
    relied_on_count: u32,
    may_store_over_members: bool,
}

impl Evaluated {
    fn values(self) -> Range<usize> {
        let first = self.first_value as usize;
        first..first + self.value_count as usize
    }

    fn relied_on(self) -> Range<usize> {
        let first = self.first_relied_on as usize;
        first..first + self.relied_on_count as usize
    }
}

#[derive(Copy, Clone, Default)]
enum Evaluation {
    #[default]
    NotAsked,
    // What it asks for is evaluated ahead of it.
    Waiting,
    Done(Evaluated),
}

#[derive(Copy, Clone, Default)]
struct DeclarationMemo {
    // By `Named`.
    evaluations: [Evaluation; 2],
    // Of the first declaration of an enum: the range of `KnownMemberValues::names` with the members of all its declarations.
    names: Option<(u32, u32)>,
}

struct FileMemo {
    file: FileId,
    // By `EnumId`, as far as somebody has asked.
    declarations: Vec<DeclarationMemo>,
}

#[derive(Copy, Clone)]
struct NamedMember {
    name: Atom,
    declaration: EnumId,
    member: EnumMemberId,
}

#[derive(Default)]
pub(crate) struct KnownMemberValues {
    // Ascending by file: those whose enums somebody has asked about, which are few beside the files of a program.
    files: RefCell<Vec<FileMemo>>,
    values: RefCell<Vec<Option<MemberValue>>>,
    // The enums of other files whose members the initializers of a declaration read. The values hold as long as nothing can store to the objects of those.
    relied_on: RefCell<Vec<Sym>>,
    // Within the range of an enum: ascending by the number of the name, each name once.
    names: RefCell<Vec<NamedMember>>,
}

impl KnownMemberValues {
    fn with_declaration<R>(
        &self,
        file: FileId,
        declaration: EnumId,
        then: impl FnOnce(&mut DeclarationMemo) -> R,
    ) -> R {
        then(&mut self.memo_of(file, declaration))
    }

    fn memo_of(&self, file: FileId, declaration: EnumId) -> RefMut<'_, DeclarationMemo> {
        RefMut::map(self.files.borrow_mut(), |files| {
            let at = match files.binary_search_by_key(&file, |memo| memo.file) {
                Ok(at) => at,
                Err(at) => {
                    let declarations = Vec::new();
                    files.insert(at, FileMemo { file, declarations });
                    at
                }
            };
            let declarations = &mut files[at].declarations;
            if declarations.len() <= declaration.idx() {
                declarations.resize(declaration.idx() + 1, DeclarationMemo::default());
            }
            &mut declarations[declaration.idx()]
        })
    }

    fn evaluation(&self, (file, declaration, named): DeclarationKey) -> Evaluation {
        self.with_declaration(file, declaration, |memo| memo.evaluations[named as usize])
    }

    fn set_evaluation(&self, (file, declaration, named): DeclarationKey, evaluation: Evaluation) {
        self.with_declaration(file, declaration, |memo| {
            memo.evaluations[named as usize] = evaluation;
        });
    }

    fn keep(&self, declaration: DeclarationKey, found: &DeclarationValues) {
        let (mut values, mut relied_on) = (self.values.borrow_mut(), self.relied_on.borrow_mut());
        let evaluated = Evaluated {
            first_value: values.len() as u32,
            value_count: found.members.len() as u32,
            first_relied_on: relied_on.len() as u32,
            relied_on_count: found.relies_on.len() as u32,
            may_store_over_members: found.may_store_over_members,
        };
        values.extend_from_slice(&found.members);
        relied_on.extend_from_slice(&found.relies_on);
        self.set_evaluation(declaration, Evaluation::Done(evaluated));
    }

    fn value_at(&self, evaluated: Evaluated, index: usize) -> Option<MemberValue> {
        let values = self.values.borrow();
        values[evaluated.values()].get(index).copied().flatten()
    }
}

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

impl Initializers<'_> {
    // `member` is one of the declaration.
    fn find_earlier(&self, hir: &hir::File<'_>, member: EnumMemberId) -> Option<Constant> {
        let index = (member.0 - hir[self.declaration].members.start) as usize;
        let earlier = self.earlier.get(index).copied().flatten()?;
        if earlier.is_known_to_build_alone {
            self.is_known_to_build_alone.set(true);
        }
        Some(earlier.value)
    }
}

/// The objects that the build knows whole because nothing but their declaration fills them: the enums at the top of the files of a program, and the
/// values of its modules of data. Each is found by binding.
#[derive(Copy, Clone)]
pub(crate) struct KnownObjects<'a, 's> {
    pub files: &'a Files<'s>,
    pub graph: &'a ModuleGraph,
    pub known: &'a KnownMemberValues,
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

// Nothing is stored or deleted there.
fn is_read(hir: &hir::File<'_>, bound: &Bound<'_>, access: ExprId) -> bool {
    let (outermost, parent) = find_parent(hir, bound, access);
    let is_deleted = matches!(parent, Parent::Expr(parent)
        if matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
    !is_deleted && bound.get_assignment_target(hir, outermost).is_none()
}

// Nor is anything called with the object as `this`.
fn is_plain_read(hir: &hir::File<'_>, bound: &Bound<'_>, access: ExprId) -> bool {
    let (outermost, parent) = find_parent(hir, bound, access);
    let is_callee = match parent {
        Parent::Expr(parent) => match hir[parent].kind {
            ExprKind::Call(call) => hir[call].callee == outermost,
            ExprKind::TaggedTemplate(template) => hir[template].callee == outermost,
            _ => false,
        },
        _ => false,
    };
    !is_callee && is_read(hir, bound, access)
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

// Every transpiler sees that such an initializer gives a string, whatever it knows of the names in it.
fn is_written_as_string(hir: &hir::File<'_>, initializer: ExprId) -> bool {
    let is_text = |expression: ExprId| {
        matches!(
            hir[hir.skip_type_assertions(expression)].kind,
            ExprKind::String(_) | ExprKind::Template { .. }
        )
    };
    match hir[hir.skip_type_assertions(initializer)].kind {
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => is_text(left) || is_text(right),
        _ => is_text(initializer),
    }
}

pub(crate) fn is_enum(bound: &Bound<'_>, symbol: SymbolId) -> bool {
    matches!(bound.symbol(symbol).decls.first(), Some(Decl::Enum(_)))
}

// An import or export statement links names to variables of the module. Every other site asks a loader, which answers with a value or with a path that a loader takes.
fn links_names_alone(site: ImportSiteKind) -> bool {
    match site {
        ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => true,
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::ImportCall(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_)
        | ImportSiteKind::MockModule(_)
        | ImportSiteKind::ImportByTestRunner(_)
        | ImportSiteKind::RequireByTestRunner(_) => false,
    }
}

struct DataLinks {
    // The modules of data, ascending.
    files: Vec<FileId>,
    // By the place in `files`: something other than an import or export statement refers to the module.
    has_other_references: Vec<bool>,
}

impl DataLinks {
    fn note_other_reference(&mut self, module: ModuleRef) {
        if let ModuleRef::File(file) = module
            && let Ok(place) = self.files.binary_search(&file)
        {
            self.has_other_references[place] = true;
        }
    }

    fn look_at_binding(&mut self, binding: ImportBinding) {
        match binding {
            ImportBinding::Namespace { module, phase } if phase != ImportPhase::Evaluation => {
                self.note_other_reference(module);
            }
            ImportBinding::NamespaceRead { module, .. } | ImportBinding::Exports { module } => {
                self.note_other_reference(module);
            }
            // Where the object goes somewhere as a value, the module stands in `namespace_values`.
            ImportBinding::Namespace { .. }
            | ImportBinding::Local
            | ImportBinding::Unused
            | ImportBinding::Unbound
            | ImportBinding::Variable(_)
            | ImportBinding::Builtin(_)
            | ImportBinding::CapturedBuiltin { .. }
            | ImportBinding::BuiltinMember { .. }
            | ImportBinding::Synthetic(_) => {}
        }
    }

    fn look_at(&mut self, row: &FileRow) {
        for &(_, binding) in &row.imports {
            self.look_at_binding(binding);
        }
        for &(_, binding) in &row.members {
            self.look_at_binding(binding);
        }
        for &(_, binding) in &row.jsx {
            self.look_at_binding(binding);
            if let ImportBinding::Namespace { module, .. } = binding {
                self.note_other_reference(module);
            }
        }
        for &module in &row.namespace_values {
            self.note_other_reference(module);
        }
        for export in &row.exports {
            match export.binding {
                ExportBinding::Namespace { module, .. }
                | ExportBinding::Indirect { module, .. } => self.note_other_reference(module),
                ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {}
            }
        }
        for (site, answer) in &row.sites {
            if links_names_alone(*site) {
                continue;
            }
            match answer {
                StoredSiteAnswer::Module(module) => self.note_other_reference(*module),
                StoredSiteAnswer::AllModules => self.has_other_references.fill(true),
                StoredSiteAnswer::Candidates(range) => {
                    for spelled in &row.spellings[range.start as usize..range.end as usize] {
                        self.note_other_reference(spelled.module);
                    }
                }
                StoredSiteAnswer::Failed(_) | StoredSiteAnswer::Erased => {}
            }
        }
    }
}

/// The modules of data that nothing in the text of the program names but statements which link names to their variables. Ascending, as the rows are.
/// It goes by the text, also of functions that nothing calls. No site names what an import under a type has made of a file, and `require` of the path answers with its object.
pub(super) fn list_data_linked_by_names_alone(
    rows: &[FileRow],
    forms_require_checks_first: &[(FileId, FileId)],
) -> Box<[FileId]> {
    let is_data = |row: &&FileRow| row.interop.kind == ModuleKind::Data && !row.is_library;
    let files: Vec<FileId> = (rows.iter().filter(is_data)).map(|row| row.file).collect();
    if files.is_empty() {
        return Box::default();
    }
    let mut links = DataLinks {
        has_other_references: vec![false; files.len()],
        files,
    };
    for row in rows {
        links.look_at(row);
    }
    for &(_, form) in forms_require_checks_first {
        links.note_other_reference(ModuleRef::File(form));
    }
    let files = links.files.into_iter().zip(links.has_other_references);
    files
        .filter(|&(_, has_other_references)| !has_other_references)
        .map(|(file, _)| file)
        .collect()
}

impl<'a, 's> KnownObjects<'a, 's> {
    pub(crate) fn new(
        files: &'a Files<'s>,
        graph: &'a ModuleGraph,
        known: &'a KnownMemberValues,
    ) -> KnownObjects<'a, 's> {
        KnownObjects {
            files,
            graph,
            known,
        }
    }

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

    // A mock stands in place of the file, or of a file that hands the variable on, or a spy stores in the variable. What another file then finds under the name is
    // theirs to say.
    fn may_be_replaced(&self, variable: Sym) -> bool {
        self.graph.may_be_mocked(ModuleRef::File(variable.file))
            || self.graph.is_replaceable(variable)
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
                match self.graph.member_binding(file, expression) {
                    Some(ImportBinding::Variable(defined)) => defined,
                    Some(_) => return None,
                    None => match self.graph.member(file, expression) {
                        Some(Member::Binding(defined)) => defined,
                        _ => return None,
                    },
                }
            }
            _ => return None,
        };
        let defined = self.follow_imports(named)?;
        if defined.file != file && self.may_be_replaced(defined) {
            return None;
        }
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

    // A member that holds a number also stores its name under the text of the number: `E[E["X"] = 0 / 0] = "X"` stores over a member named `NaN`.
    fn may_be_text_of_number(&self, name: Atom) -> bool {
        matches!(
            classify_name(self.files.atoms.bytes(name)),
            NameClass::Index | NameClass::CanonicalNumericString
        )
    }

    fn list_members_by_name(&self, enumeration: Sym) -> Vec<NamedMember> {
        let (hir, bound) = (
            self.files.hir(enumeration.file),
            self.files.bound(enumeration.file),
        );
        let mut members = Vec::new();
        for &declaration in bound.symbol(enumeration.id).decls {
            let Decl::Enum(declaration) = declaration else {
                return Vec::new();
            };
            for member in hir[declaration].members.iter() {
                if hir[member].computed_name.is_none() {
                    members.push(NamedMember {
                        name: hir[member].name,
                        declaration,
                        member,
                    });
                }
            }
        }
        members.sort_unstable_by_key(|member| member.name.0);
        // A later member of the same name stores over the earlier one.
        let runs = members.chunk_by(|a, b| a.name == b.name);
        runs.filter_map(|run| match run {
            [only] => Some(*only),
            _ => None,
        })
        .collect()
    }

    fn find_member(&self, enumeration: Sym, name: Atom) -> Option<(EnumId, EnumMemberId)> {
        let declarations = self
            .files
            .bound(enumeration.file)
            .symbol(enumeration.id)
            .decls;
        let Some(&Decl::Enum(first)) = declarations.first() else {
            return None;
        };
        let file = enumeration.file;
        let listed = self.known.with_declaration(file, first, |memo| memo.names);
        let (start, end) = listed.unwrap_or_else(|| {
            let members = self.list_members_by_name(enumeration);
            let mut names = self.known.names.borrow_mut();
            let start = names.len() as u32;
            names.extend_from_slice(&members);
            let range = (start, names.len() as u32);
            self.known
                .with_declaration(file, first, |memo| memo.names = Some(range));
            range
        });
        let names = self.known.names.borrow();
        let names = &names[start as usize..end as usize];
        let at = names
            .binary_search_by_key(&name.0, |member| member.name.0)
            .ok()?;
        Some((names[at].declaration, names[at].member))
    }

    // The member that a read names, with its enum and the declaration that it is written in.
    fn find_named_member(
        &self,
        file: FileId,
        access: ExprId,
    ) -> Option<(Sym, EnumId, EnumMemberId)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        if !is_link_of_no_chain(hir, access) || !is_read(hir, bound, access) {
            return None;
        }
        if let Some(member) = find_member_followed_by_transpiler(self.files, file, access) {
            let declaration = bound.enum_member_owner[member.idx()];
            let id = bound.declared_symbol(Decl::Enum(declaration));
            return Some((Sym { file, id }, declaration, member));
        }
        let atoms = &self.files.atoms;
        let link = find_link_followed_by_transpiler(hir, access, |name| atoms.bytes(name));
        let (object, name) = link?;
        let enumeration = self.find_enum(file, object)?;
        if enumeration.file == file {
            return None;
        }
        let (declaration, member) = self.find_member(enumeration, name)?;
        Some((enumeration, declaration, member))
    }

    fn declarations_of(&self, enumeration: Sym) -> impl Iterator<Item = DeclarationKey> {
        let file = enumeration.file;
        let declarations = self.files.bound(file).symbol(enumeration.id).decls.iter();
        declarations.filter_map(move |&declaration| match declaration {
            Decl::Enum(declaration) => Some((file, declaration, Named::OwnAndEarlier)),
            _ => None,
        })
    }

    pub(crate) fn find_read(&self, file: FileId, access: ExprId) -> Option<MemberRead> {
        let named = self.find_named_member(file, access)?;
        let values = self.values_of((named.0.file, named.1, Named::OwnAndEarlier));
        let read = self.read_member(file, access, named, values)?;
        let may_be_stored_over = read.validity == Validity::WhileObjectIsNotHandedOn
            && (self.declarations_of(named.0))
                .any(|declaration| self.values_of(declaration).may_store_over_members);
        (!may_be_stored_over).then_some(read)
    }

    /// The enums of other files that the values of the members of an enum rest on.
    pub(crate) fn enums_relied_on(&self, enumeration: Sym) -> SmallVec<[Sym; 2]> {
        let mut relied_on = SmallVec::new();
        for declaration in self.declarations_of(enumeration) {
            let values = self.values_of(declaration);
            relied_on.extend_from_slice(&self.known.relied_on.borrow()[values.relied_on()]);
        }
        relied_on
    }

    /// The value that the transpiler has for a member of an enum of the file. It stands in place of every read that the transpiler follows to the member.
    pub(crate) fn find_value_in_place(
        &self,
        file: FileId,
        member: EnumMemberId,
    ) -> Option<Constant> {
        let declaration = self.files.bound(file).enum_member_owner[member.idx()];
        let values = self.values_of((file, declaration, Named::OwnAndEarlier));
        let index = (member.0 - self.files.hir(file)[declaration].members.start) as usize;
        let known = self.known.value_at(values, index)?;
        (!known.is_known_to_build_alone).then_some(known.value)
    }

    /// `-Level.Low`: wherever it stands, `bun build` writes a number for a sign in front of a member of the file that it has as a number.
    pub(crate) fn find_signed_member_in_place(
        &self,
        file: FileId,
        expression: ExprId,
    ) -> Option<f64> {
        let hir = self.files.hir(file);
        let mut innermost = hir.skip_type_assertions(expression);
        let mut sign = None;
        while let ExprKind::Unary {
            op: op @ (UnOp::Plus | UnOp::Minus),
            operand,
        } = hir[innermost].kind
        {
            let outer = sign.unwrap_or(1.0);
            sign = Some(if op == UnOp::Minus { -outer } else { outer });
            innermost = hir.skip_type_assertions(operand);
        }
        let sign = sign?;
        let read = self.find_read(file, innermost)?;
        match read.value {
            Constant::Number(number)
                if read.object.file == file && read.validity == Validity::Always =>
            {
                Some(sign * number)
            }
            _ => None,
        }
    }

    fn read_member(
        &self,
        file: FileId,
        access: ExprId,
        (enumeration, declaration, member): (Sym, EnumId, EnumMemberId),
        values: Evaluated,
    ) -> Option<MemberRead> {
        let declared_in = self.files.hir(enumeration.file);
        let index = (member.0 - declared_in[declaration].members.start) as usize;
        let MemberValue {
            value,
            is_known_to_build_alone,
        } = self.known.value_at(values, index)?;
        let name = declared_in[member].name;
        // `bun test` assigns the members and reads a member of another file off the object. Below a name that a test run lays on `Object.prototype` the enum may have no such member.
        if enumeration.file != file && self.is_laid_on_object_prototype(name) {
            return None;
        }
        let validity = if !is_known_to_build_alone {
            Validity::Always
        } else if enumeration.file != file
            && !self.graph.half(ModuleRef::File(file))
            // `Object.prototype` has an accessor named `__proto__`, which takes the store.
            && name != known::__proto__
            && !self.may_be_text_of_number(name)
            && is_plain_read(self.files.hir(file), self.files.bound(file), access)
        {
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

    /// The enum, where the expression evaluates to its object and what takes the object only looks something up in it: `Color[key]`, `Color[Color.Red]`,
    /// `key in Color`, `for (key in Color)`.
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

    fn is_data_module(&self, file: FileId) -> bool {
        self.graph.has_record(file) && self.graph.kind(file) == ModuleKind::Data
    }

    // Whoever gets hold of the value of the module does so through one of its variables. A loader that is given a name which the build does not know finds the
    // module all the same: whoever follows the code that is reached sees that.
    fn is_reached_through_variables_alone(&self, file: FileId) -> bool {
        let module = ModuleRef::File(file);
        let listed = &self.graph.data_linked_by_names_alone;
        self.is_data_module(file)
            && !self.graph.may_be_mocked(module)
            // The loader of the run time links the statements of a test file to a module that may load again, and hands over whatever it exports.
            && !self.graph.may_be_evicted(module)
            && listed.binary_search(&file).is_ok()
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
        if !self.is_reached_through_variables_alone(file) {
            return None;
        }
        let object = self.find_variable_with_object(file)?;
        (!self.graph.is_replaceable(object)).then_some(object)
    }

    /// The variable with the object of a module of data, where another variable of the module holds an object out of it: `import { nested } from "./data.json"`.
    /// Also of a module whose object the build does not see every way to.
    pub(crate) fn find_data_object_shared_by(&self, variable: Sym) -> Option<Sym> {
        if !self.is_data_module(variable.file) {
            return None;
        }
        let object = self.find_variable_with_object(variable.file)?;
        let holds_no_object = variable != object && self.find_data_variable(variable).is_some();
        (!holds_no_object).then_some(object)
    }

    /// What a variable of a module of data holds from before any code of the program runs, where that is no object: `import { version } from "./data.json"`.
    pub(crate) fn find_data_variable(&self, variable: Sym) -> Option<(Sym, Constant)> {
        let variable = self.follow_imports(variable)?;
        if !self.is_data_module(variable.file) || self.may_be_replaced(variable) {
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
            || self.may_be_replaced(object)
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
            // A key that is written twice holds what is written last.
            value = &entries.iter().rfind(|entry| entry.0 == name)?.1;
        }
        let Decision::Constant(value) = Decision::of_data(value) else {
            return None;
        };
        // Such a module has its value before any code of the program runs.
        is_plain_read(hir, bound, access).then_some((object, value))
    }

    fn is_laid_on_object_prototype(&self, name: Atom) -> bool {
        match name.is_some() {
            true => (self.graph).is_laid_on_object_prototype(self.files.atoms.bytes(name)),
            // `enum E { [key] }`: the parser recovers, the member has no name, and what it would store under may be any of them.
            false => !self.graph.names_laid_on_object_prototype.is_empty(),
        }
    }

    /// To run such a declaration may be to run a setter of the tests.
    pub(crate) fn stores_under_name_laid_on_object_prototype(
        &self,
        file: FileId,
        declaration: EnumId,
    ) -> bool {
        let hir = self.files.hir(file);
        let mut members = hir[declaration].members.iter();
        members.any(|member| self.is_laid_on_object_prototype(hir[member].name))
    }

    /// To run such a declaration is to make the object and nothing else.
    pub(crate) fn knows_every_member(&self, file: FileId, declaration: EnumId) -> bool {
        let values = self.values_of((file, declaration, Named::OwnAndEarlier));
        let known = self.known.values.borrow();
        known[values.values()].iter().all(Option::is_some)
    }

    // What is known of a declaration hangs on the declaration alone, never on who asks first: a build asks in more than one order.
    // An enum may be made of an enum that is made of an enum, however often: what a declaration asks for is evaluated ahead of it, and no call stands in another.
    fn values_of(&self, declaration: DeclarationKey) -> Evaluated {
        if let Evaluation::Done(evaluated) = self.known.evaluation(declaration) {
            return evaluated;
        }
        let mut waiting: SmallVec<[DeclarationKey; 4]> = SmallVec::new();
        waiting.push(declaration);
        while let Some(&next) = waiting.last() {
            if let Evaluation::Done(_) = self.known.evaluation(next) {
                waiting.pop();
                continue;
            }
            self.known.set_evaluation(next, Evaluation::Waiting);
            match self.compute_values(next) {
                Ok(values) => self.known.keep(next, &values),
                Err(asked_for) => match self.known.evaluation(asked_for) {
                    Evaluation::NotAsked => waiting.push(asked_for),
                    // An initializer asks only for what has run before it, so no declaration comes to ask for itself.
                    Evaluation::Waiting | Evaluation::Done(_) => {
                        debug_assert!(false, "enums are made of each other");
                        let nothing = DeclarationValues {
                            members: vec![None; self.files.hir(next.0)[next.1].members.len()],
                            relies_on: Vec::new(),
                            may_store_over_members: true,
                        };
                        self.known.keep(next, &nothing);
                    }
                },
            }
        }
        match self.known.evaluation(declaration) {
            Evaluation::Done(evaluated) => evaluated,
            Evaluation::NotAsked | Evaluation::Waiting => {
                unreachable!("the loop ends when the declaration is evaluated")
            }
        }
    }

    fn compute_values(
        &self,
        (file, declaration, named): DeclarationKey,
    ) -> Result<DeclarationValues, DeclarationKey> {
        let hir = self.files.hir(file);
        let members = hir[declaration].members;
        let mut values: Vec<Option<MemberValue>> = Vec::with_capacity(members.len());
        let mut may_store_over_members = false;
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
            let holds_number = matches!(value, Some(Constant::Number(_)));
            let holds_string = (node.init.some())
                .is_some_and(|initializer| is_written_as_string(hir, initializer));
            may_store_over_members |= !holds_number && !holds_string;
            values.push(value.map(|value| MemberValue {
                value,
                is_known_to_build_alone: is_known_to_build_alone.get(),
            }));
        }
        Ok(DeclarationValues {
            members: values,
            relies_on: relies_on.into_inner(),
            may_store_over_members,
        })
    }

    // The number or the string that an initializer evaluates to whenever it runs.
    fn evaluate(&self, initializers: Initializers<'_>, expression: ExprId) -> Option<Constant> {
        let value = self.evaluate_constant(initializers, expression)?;
        matches!(value, Constant::Number(_) | Constant::String(_)).then_some(value)
    }

    fn is_truthy(&self, value: Constant) -> Option<bool> {
        match fold::apply_unary(&self.files.atoms, UnOp::Not, value)? {
            Constant::Boolean(is_falsy) => Some(!is_falsy),
            _ => None,
        }
    }

    fn evaluate_constant(
        &self,
        initializers: Initializers<'_>,
        expression: ExprId,
    ) -> Option<Constant> {
        let hir = self.files.hir(initializers.file);
        let decisions = &self.files.analysis(initializers.file).decisions;
        let atoms = &self.files.atoms;
        // `A | B | C | ..` leans to the left, however long it is.
        let mut right_operands: SmallVec<[(BinOp, ExprId); 8]> = SmallVec::new();
        let mut leftmost = hir.skip_type_assertions(expression);
        let mut value = loop {
            match (decisions.constant(hir, leftmost), hir[leftmost].kind) {
                (FoldedValue::Constant(constant), _) => {
                    if !decisions.is_constant_in_bun_run(hir, leftmost) {
                        initializers.is_known_to_build_alone.set(true);
                    }
                    break constant;
                }
                (_, ExprKind::Binary { op, left, right }) => {
                    right_operands.push((op, right));
                    leftmost = hir.skip_type_assertions(left);
                }
                _ => break self.evaluate_operand(initializers, leftmost)?,
            }
        };
        while let Some((op, right)) = right_operands.pop() {
            let takes_right = match op {
                BinOp::And => Some(self.is_truthy(value)?),
                BinOp::Or => Some(!self.is_truthy(value)?),
                BinOp::Nullish => Some(matches!(value, Constant::Null | Constant::Undefined)),
                _ => None,
            };
            value = match takes_right {
                Some(true) => self.evaluate_constant(initializers, right)?,
                Some(false) => value,
                None => {
                    let operands = [value, self.evaluate_constant(initializers, right)?];
                    if !fold::is_computed_by_transpiler(atoms, op, operands) {
                        initializers.is_known_to_build_alone.set(true);
                    }
                    fold::apply_binary(atoms, op, operands, MAX_FOLDED_STRING_BYTES)?
                }
            };
        }
        Some(value)
    }

    fn evaluate_operand(
        &self,
        initializers: Initializers<'_>,
        expression: ExprId,
    ) -> Option<Constant> {
        let file = initializers.file;
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        match hir[expression].kind {
            ExprKind::Unary { op, operand }
                if matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot) =>
            {
                let operand = self.evaluate(initializers, operand)?;
                fold::apply_unary(&self.files.atoms, op, operand)
            }
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => {
                let operand = self.evaluate_constant(initializers, operand)?;
                fold::apply_unary(&self.files.atoms, UnOp::Not, operand)
            }
            ExprKind::Template { exprs } => {
                let mut substitutions: SmallVec<[Constant; 4]> = SmallVec::new();
                for substitution in hir.ids(exprs) {
                    substitutions.push(self.evaluate(initializers, substitution)?);
                }
                let texts: SmallVec<[Atom; 4]> = hir.ids(hir.template_texts(exprs)).collect();
                let atoms = &self.files.atoms;
                fold::apply_template(atoms, &texts, &substitutions, MAX_FOLDED_STRING_BYTES)
            }
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(expression) else {
                    return None;
                };
                let [Decl::EnumMember(member)] = *bound.symbol(symbol).decls else {
                    return None;
                };
                if bound.enum_member_owner[member.idx()] != initializers.declaration {
                    return None;
                }
                initializers.find_earlier(hir, member)
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self
                .evaluate_length(initializers, expression)
                .or_else(|| self.evaluate_member_read(initializers, expression)),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let test = self.evaluate_constant(initializers, test)?;
                let arm = match self.is_truthy(test)? {
                    true => branches.yes,
                    false => branches.no,
                };
                self.evaluate_constant(initializers, arm)
            }
            _ => None,
        }
    }

    // `"text".length`
    fn evaluate_length(&self, initializers: Initializers<'_>, access: ExprId) -> Option<Constant> {
        let hir = self.files.hir(initializers.file);
        let (text, MemberKey::Name(name)) = hir.member_key(access)? else {
            return None;
        };
        if name != known::length {
            return None;
        }
        let Constant::String(text) = self.evaluate(initializers, text)? else {
            return None;
        };
        initializers.is_known_to_build_alone.set(true);
        let length = strings::wtf8_len_utf16(self.files.atoms.bytes(text));
        Some(Constant::Number(f64::from(length)))
    }

    // `Color.Green`, where the initializer of a member of an enum reads it.
    fn evaluate_member_read(
        &self,
        initializers: Initializers<'_>,
        access: ExprId,
    ) -> Option<Constant> {
        let Initializers {
            file,
            declaration,
            named,
            ..
        } = initializers;
        let hir = self.files.hir(file);
        let found = self.find_named_member(file, access)?;
        let (enumeration, owner, member) = found;
        if enumeration.file == file && owner == declaration {
            return initializers.find_earlier(hir, member);
        }
        if named == Named::Own {
            return None;
        }
        // The other declaration stands further up in the file, or in a file that has run. A file on a cycle reads a `const enum` of
        // another file all the same: of that one the members count that name none but their own.
        let has_run_before = match enumeration.file == file {
            true => is_member_visited_before(hir, member, access),
            false => !self.graph.half(ModuleRef::File(file)),
        };
        let other = match has_run_before {
            true => (enumeration.file, owner, Named::OwnAndEarlier),
            false if enumeration.file == file => return None,
            false => (enumeration.file, owner, Named::Own),
        };
        let Evaluation::Done(values) = self.known.evaluation(other) else {
            initializers.asked_for.set(Some(other));
            return None;
        };
        let read = self.read_member(file, access, found, values)?;
        // `bun build` puts the member of another file in place when it prints, behind the visit that gives the members of this enum their values.
        if enumeration.file != file {
            initializers.is_known_to_build_alone.set(true);
        }
        if read.validity == Validity::WhileObjectIsNotHandedOn {
            // Each declaration of the enum stores to the object that is read.
            let mut parts: SmallVec<[Evaluated; 1]> = SmallVec::new();
            for part in self.declarations_of(enumeration) {
                match self.known.evaluation(part) {
                    Evaluation::Done(evaluated) if !evaluated.may_store_over_members => {
                        parts.push(evaluated);
                    }
                    Evaluation::Done(_) => return None,
                    Evaluation::NotAsked | Evaluation::Waiting => {
                        initializers.asked_for.set(Some(part));
                        return None;
                    }
                }
            }
            initializers.is_known_to_build_alone.set(true);
            let mut relies_on = initializers.relies_on.borrow_mut();
            let relied_on = self.known.relied_on.borrow();
            let relied_on_there = parts.iter().flat_map(|part| &relied_on[part.relied_on()]);
            for &relied_on in [enumeration].iter().chain(relied_on_there) {
                if !relies_on.contains(&relied_on) {
                    relies_on.push(relied_on);
                }
            }
        }
        Some(read.value)
    }
}

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
    Always,
    WhileObjectIsNotHandedOn,
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub(crate) struct MemberRead {
    pub object: Sym,
    pub value: Constant,
    pub validity: Validity,
}

#[derive(Copy, Clone)]
struct MemberValue {
    value: Constant,
    known_to: KnownTo,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum KnownTo {
    EveryTranspiler,
    BunRun,
    BuildAlone,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Named {
    OwnAndEarlier,
    Own,
}

type DeclarationKey = (FileId, EnumId, Named);

struct DeclarationValues {
    members: Vec<Option<MemberValue>>,
    relies_on: Vec<Sym>,
    may_store_over_members: bool,
}

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
    Waiting,
    Done(Evaluated),
}

#[derive(Copy, Clone, Default)]
struct DeclarationMemo {
    evaluations: [Evaluation; 2],
    names: Option<(u32, u32)>,
}

struct FileMemo {
    file: FileId,
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
    files: RefCell<Vec<FileMemo>>,
    values: RefCell<Vec<Option<MemberValue>>>,
    relied_on: RefCell<Vec<Sym>>,
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

#[derive(Copy, Clone)]
struct Initializers<'a> {
    file: FileId,
    declaration: EnumId,
    earlier: &'a [Option<MemberValue>],
    named: Named,
    known_to: &'a Cell<KnownTo>,
    relies_on: &'a RefCell<Vec<Sym>>,
    asked_for: &'a Cell<Option<DeclarationKey>>,
}

impl Initializers<'_> {
    fn find_earlier(&self, hir: &hir::File<'_>, member: EnumMemberId) -> Option<Constant> {
        let index = (member.0 - hir[self.declaration].members.start) as usize;
        let earlier = self.earlier.get(index).copied().flatten()?;
        self.rest_on(earlier.known_to);
        Some(earlier.value)
    }

    fn rest_on(&self, known_to: KnownTo) {
        self.known_to.set(self.known_to.get().max(known_to));
    }
}

#[derive(Copy, Clone)]
pub(crate) struct KnownObjects<'a, 's> {
    pub files: &'a Files<'s>,
    pub graph: &'a ModuleGraph,
    pub known: &'a KnownMemberValues,
}

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

fn is_read_under(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    outermost: ExprId,
    parent: Parent,
) -> bool {
    let is_deleted = matches!(parent, Parent::Expr(parent)
        if matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
    !is_deleted && bound.get_assignment_target(hir, outermost).is_none()
}

fn is_read(hir: &hir::File<'_>, bound: &Bound<'_>, access: ExprId) -> bool {
    let (outermost, parent) = find_parent(hir, bound, access);
    is_read_under(hir, bound, outermost, parent)
}

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
    !is_callee && is_read_under(hir, bound, outermost, parent)
}

fn find_object_of_link_of_no_chain(hir: &hir::File<'_>, access: ExprId) -> Option<ExprId> {
    match hir[access].kind {
        ExprKind::Dot {
            obj,
            chain: Chain::No,
            ..
        }
        | ExprKind::Index {
            obj,
            chain: Chain::No,
            ..
        } => Some(obj),
        _ => None,
    }
}

fn is_link_of_no_chain(hir: &hir::File<'_>, access: ExprId) -> bool {
    find_object_of_link_of_no_chain(hir, access).is_some()
}

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
    files: Vec<FileId>,
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

    #[inline]
    fn find_row(&self, file: FileId) -> Option<&'a FileRow> {
        let index = self.graph.row_by_file.get(file.idx()).copied().flatten()?;
        Some(&self.graph.rows[index as usize])
    }

    fn follow_imports(&self, mut defined: Sym) -> Option<(Sym, &'a FileRow)> {
        loop {
            let row = self.find_row(defined.file)?;
            let is_among_imports = matches!(
                (row.imports.first(), row.imports.last()),
                (Some(first), Some(last)) if first.0 <= defined.id && defined.id <= last.0
            );
            if !is_among_imports {
                return Some((defined, row));
            }
            match self.graph.import_binding(defined.file, defined.id) {
                ImportBinding::Local => return Some((defined, row)),
                ImportBinding::Variable(elsewhere) if elsewhere != defined => defined = elsewhere,
                _ => return None,
            }
        }
    }

    fn may_be_replaced(&self, variable: Sym) -> bool {
        self.graph.may_be_mocked(ModuleRef::File(variable.file))
            || self.graph.is_replaceable(variable)
    }

    pub(crate) fn find_enum(&self, file: FileId, expression: ExprId) -> Option<Sym> {
        let row = self.find_row(file)?;
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        let named = match hir[expression].kind {
            ExprKind::Ident(_) if hir.enums.is_empty() && row.imports.is_empty() => return None,
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
        let (defined, _) = self.follow_imports(named)?;
        if defined.file != file && self.may_be_replaced(defined) {
            return None;
        }
        let (hir, bound) = match defined.file == file {
            true => (hir, bound),
            false => (self.files.hir(defined.file), self.files.bound(defined.file)),
        };
        if hir.enums.is_empty() {
            return None;
        }
        let is_made_at_top_of_file = |&declaration: &Decl| match declaration {
            Decl::Enum(declaration) => {
                let node = &hir[declaration];
                !node.flags.contains(Flags::AMBIENT)
                    && bound.parent_of_stmt(node.stmt) == Parent::File
            }
            _ => false,
        };
        let declarations = bound.symbol(defined.id).decls;
        let is_known_whole = !declarations.is_empty()
            && declarations.iter().all(is_made_at_top_of_file)
            && bound.runtime.eval_scopes().is_empty();
        is_known_whole.then_some(defined)
    }

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

    fn find_named_member(
        &self,
        file: FileId,
        access: ExprId,
    ) -> Option<(Sym, EnumId, EnumMemberId)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let object = find_object_of_link_of_no_chain(hir, access)?;
        let declares_enums = !hir.enums.is_empty();
        if declares_enums {
            if !is_read(hir, bound, access) {
                return None;
            }
            if let Some(member) = find_member_followed_by_transpiler(self.files, file, access) {
                let declaration = bound.enum_member_owner[member.idx()];
                let id = bound.declared_symbol(Decl::Enum(declaration));
                return Some((Sym { file, id }, declaration, member));
            }
        }
        let enumeration = self.find_enum(file, object)?;
        if enumeration.file == file || !(declares_enums || is_read(hir, bound, access)) {
            return None;
        }
        let atoms = &self.files.atoms;
        let link = find_link_followed_by_transpiler(hir, access, |name| atoms.bytes(name));
        let (_, name) = link?;
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
        let (read, _) = self.read_member(file, access, named, values)?;
        let may_be_stored_over = read.validity == Validity::WhileObjectIsNotHandedOn
            && (self.declarations_of(named.0))
                .any(|declaration| self.values_of(declaration).may_store_over_members);
        (!may_be_stored_over).then_some(read)
    }

    pub(crate) fn enums_relied_on(&self, enumeration: Sym) -> SmallVec<[Sym; 2]> {
        let mut relied_on = SmallVec::new();
        for declaration in self.declarations_of(enumeration) {
            let values = self.values_of(declaration);
            relied_on.extend_from_slice(&self.known.relied_on.borrow()[values.relied_on()]);
        }
        relied_on
    }

    pub(crate) fn find_value_in_place(
        &self,
        file: FileId,
        member: EnumMemberId,
    ) -> Option<Constant> {
        let declaration = self.files.bound(file).enum_member_owner[member.idx()];
        let values = self.values_of((file, declaration, Named::OwnAndEarlier));
        let index = (member.0 - self.files.hir(file)[declaration].members.start) as usize;
        let known = self.known.value_at(values, index)?;
        (known.known_to != KnownTo::BuildAlone).then_some(known.value)
    }

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
    ) -> Option<(MemberRead, KnownTo)> {
        let declared_in = self.files.hir(enumeration.file);
        let index = (member.0 - declared_in[declaration].members.start) as usize;
        let MemberValue { value, known_to } = self.known.value_at(values, index)?;
        let name = declared_in[member].name;
        if enumeration.file != file && self.is_laid_on_object_prototype(name) {
            return None;
        }
        let is_in_place = match known_to {
            KnownTo::EveryTranspiler => true,
            KnownTo::BunRun => enumeration.file == file,
            KnownTo::BuildAlone => false,
        };
        let validity = if is_in_place {
            Validity::Always
        } else if enumeration.file != file
            && !self.graph.half(ModuleRef::File(file))
            && name != known::__proto__
            && !self.may_be_text_of_number(name)
            && is_plain_read(self.files.hir(file), self.files.bound(file), access)
        {
            Validity::WhileObjectIsNotHandedOn
        } else {
            return None;
        };
        let read = MemberRead {
            object: enumeration,
            value,
            validity,
        };
        Some((read, known_to))
    }

    pub(crate) fn find_lookup(&self, file: FileId, object: ExprId) -> Option<Sym> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let (outermost, parent) = find_parent(hir, bound, object);
        let mut link = None;
        let may_be_lookup = match parent {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    link = Some(parent);
                    obj == outermost && is_link_of_no_chain(hir, parent)
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
        if !may_be_lookup {
            return None;
        }
        let enumeration = self.find_enum(file, object)?;
        link.is_none_or(|link| is_plain_read(hir, bound, link))
            .then_some(enumeration)
    }

    fn is_data_module(&self, file: FileId) -> bool {
        self.find_row(file)
            .is_some_and(|row| row.interop.kind == ModuleKind::Data)
    }

    fn is_reached_through_variables_alone(&self, file: FileId) -> bool {
        let module = ModuleRef::File(file);
        let listed = &self.graph.data_linked_by_names_alone;
        self.is_data_module(file)
            && !self.graph.may_be_mocked(module)
            && !self.graph.may_be_evicted(module)
            && listed.binary_search(&file).is_ok()
    }

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

    pub(crate) fn find_data_object(&self, file: FileId) -> Option<Sym> {
        if !self.is_reached_through_variables_alone(file) {
            return None;
        }
        let object = self.find_variable_with_object(file)?;
        (!self.graph.is_replaceable(object)).then_some(object)
    }

    pub(crate) fn find_data_object_shared_by(&self, variable: Sym) -> Option<Sym> {
        if !self.is_data_module(variable.file) {
            return None;
        }
        let object = self.find_variable_with_object(variable.file)?;
        let holds_no_object = variable != object && self.find_data_variable(variable).is_some();
        (!holds_no_object).then_some(object)
    }

    pub(crate) fn find_data_variable(&self, variable: Sym) -> Option<(Sym, Constant)> {
        let (variable, row) = self.follow_imports(variable)?;
        if row.interop.kind != ModuleKind::Data || self.may_be_replaced(variable) {
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

    pub(crate) fn data_variables(&self, file: FileId) -> impl Iterator<Item = (Sym, VarDeclId)> {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let declarators = (0..hir.var_decls.len() as u32).map(VarDeclId);
        declarators.map(move |declarator| {
            let id = bound.declared_symbol(Decl::Var(hir[declarator].pat));
            (Sym { file, id }, declarator)
        })
    }

    pub(crate) fn find_data_read(&self, file: FileId, access: ExprId) -> Option<MemberRead> {
        let (object, value) = self.find_data_value(file, access)?;
        let validity = Validity::WhileObjectIsNotHandedOn;
        (self.is_reached_through_variables_alone(object.file)).then_some(MemberRead {
            object,
            value,
            validity,
        })
    }

    fn find_data_value(&self, file: FileId, access: ExprId) -> Option<(Sym, Constant)> {
        let row = self.find_row(file)?;
        if row.interop.kind != ModuleKind::Data && row.imports.is_empty() {
            return None;
        }
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let outermost_link = hir.skip_type_assertions(access);
        let mut link = outermost_link;
        let root = loop {
            let object = find_object_of_link_of_no_chain(hir, link)?;
            link = hir.skip_type_assertions(object);
            if matches!(hir[link].kind, ExprKind::Ident(_)) {
                break link;
            }
        };
        let Binding::Symbol(id) = bound.binding(root) else {
            return None;
        };
        let (object, row) = self.follow_imports(Sym { file, id })?;
        if row.interop.kind != ModuleKind::Data
            || self.may_be_replaced(object)
            || self.find_variable_with_object(object.file) != Some(object)
        {
            return None;
        }
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut link = outermost_link;
        while link != root {
            let Some((object, MemberKey::Name(name))) = hir.member_key(link) else {
                return None;
            };
            names.push(name);
            link = hir.skip_type_assertions(object);
        }
        let mut value = self.find_data_in(object)?;
        for &name in names.iter().rev() {
            let DataValue::Object(entries) = *value else {
                return None;
            };
            if name == known::__proto__ {
                return None;
            }
            value = &entries.iter().rfind(|entry| entry.0 == name)?.1;
        }
        let Decision::Constant(value) = Decision::of_data(value) else {
            return None;
        };
        is_plain_read(hir, bound, access).then_some((object, value))
    }

    fn is_laid_on_object_prototype(&self, name: Atom) -> bool {
        match name.is_some() {
            true => (self.graph).is_laid_on_object_prototype(self.files.atoms.bytes(name)),
            false => !self.graph.names_laid_on_object_prototype.is_empty(),
        }
    }

    pub(crate) fn stores_under_name_laid_on_object_prototype(
        &self,
        file: FileId,
        declaration: EnumId,
    ) -> bool {
        let hir = self.files.hir(file);
        let mut members = hir[declaration].members.iter();
        members.any(|member| self.is_laid_on_object_prototype(hir[member].name))
    }

    pub(crate) fn knows_every_member(&self, file: FileId, declaration: EnumId) -> bool {
        let values = self.values_of((file, declaration, Named::OwnAndEarlier));
        let known = self.known.values.borrow();
        known[values.values()].iter().all(Option::is_some)
    }

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
        let mut counted = Some(0.0);
        let known_to = Cell::new(KnownTo::EveryTranspiler);
        let relies_on = RefCell::new(Vec::new());
        let asked_for = Cell::new(None);
        for member in members.iter() {
            let node = &hir[member];
            let value = if node.computed_name.is_some() {
                None
            } else if let Some(initializer) = node.init.some() {
                known_to.set(KnownTo::EveryTranspiler);
                let initializers = Initializers {
                    file,
                    declaration,
                    earlier: &values,
                    named,
                    known_to: &known_to,
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
                known_to: known_to.get(),
            }));
        }
        Ok(DeclarationValues {
            members: values,
            relies_on: relies_on.into_inner(),
            may_store_over_members,
        })
    }

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
        let mut right_operands: SmallVec<[(BinOp, ExprId); 8]> = SmallVec::new();
        let mut leftmost = hir.skip_type_assertions(expression);
        let mut value = loop {
            match (decisions.constant(hir, leftmost), hir[leftmost].kind) {
                (FoldedValue::Constant(constant), _) => {
                    initializers.rest_on(match () {
                        () if decisions.is_constant_in_bun_run(hir, leftmost) => {
                            KnownTo::EveryTranspiler
                        }
                        () if decisions.is_constant_under_minify_syntax(hir, leftmost) => {
                            KnownTo::BunRun
                        }
                        () => KnownTo::BuildAlone,
                    });
                    break constant;
                }
                (FoldedValue::ConstantOutsideDeadZone(constant), _)
                    if decisions.is_constant_under_minify_syntax(hir, leftmost) =>
                {
                    initializers.rest_on(match decisions.is_constant_in_bun_run(hir, leftmost) {
                        true => KnownTo::EveryTranspiler,
                        false => KnownTo::BunRun,
                    });
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
                        initializers.rest_on(KnownTo::BuildAlone);
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
                let owner = bound.enum_member_owner[member.idx()];
                if owner == initializers.declaration {
                    return initializers.find_earlier(hir, member);
                }
                let id = bound.declared_symbol(Decl::Enum(owner));
                let enumeration = Sym { file, id };
                let (owner, member) = self.find_member(enumeration, hir[member].name)?;
                self.evaluate_member_found(initializers, expression, (enumeration, owner, member))
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
        initializers.rest_on(KnownTo::BuildAlone);
        let length = strings::wtf8_len_utf16(self.files.atoms.bytes(text));
        Some(Constant::Number(f64::from(length)))
    }

    fn evaluate_member_read(
        &self,
        initializers: Initializers<'_>,
        access: ExprId,
    ) -> Option<Constant> {
        let found = self.find_named_member(initializers.file, access)?;
        self.evaluate_member_found(initializers, access, found)
    }

    fn evaluate_member_found(
        &self,
        initializers: Initializers<'_>,
        access: ExprId,
        found: (Sym, EnumId, EnumMemberId),
    ) -> Option<Constant> {
        let Initializers {
            file,
            declaration,
            named,
            ..
        } = initializers;
        let hir = self.files.hir(file);
        let (enumeration, owner, member) = found;
        if enumeration.file == file && owner == declaration {
            return initializers.find_earlier(hir, member);
        }
        if named == Named::Own {
            return None;
        }
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
        let (read, known_to) = self.read_member(file, access, found, values)?;
        initializers.rest_on(match enumeration.file == file {
            true => known_to,
            false => KnownTo::BuildAlone,
        });
        if read.validity == Validity::WhileObjectIsNotHandedOn {
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
            initializers.rest_on(KnownTo::BuildAlone);
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

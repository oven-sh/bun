use super::{ByFile, FieldKey};
use crate::atom::{Atom, known};
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId, UNREACHABLE};
use crate::check::Checker;
use crate::hir::{
    BinOp, CallId, Chain, ClassId, EnumMemberId, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, FnKind, IdList, ImportEqualsId, ImportEqualsTarget, MemberId, MemberKind, ModuleId, PatId, PatKind, PropKey, PropKind, StmtId, StmtKind, TypeNodeId, TypeNodeKind, UnOp,
    VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{Origin, PropFlags, PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use super::OnceLock;
use super::flows::Place;
use super::storage::Primitive;
use crate::aot_rules::{Rule, Scopes, Severity};
use crate::check::CompilerDiagnostic;

#[derive(Default)]
pub(super) struct Shared {
    method_declarations: std::sync::OnceLock<MethodDeclarations>,
    computed_methods: OnceLock<Vec<((FileId, ClassId), ExprId)>>,
    by_file: ByFile<FileFacts>,
    discriminants: std::sync::OnceLock<Discriminants>,
    mutable_prototypes: std::sync::OnceLock<MutablePrototypes>,
    builtin_requires: OnceLock<FxHashMap<(FileId, Atom), FileId>>,
    reified_namespaces: OnceLock<ReifiedNamespaces>,
    reassigned_enum_members: OnceLock<FxHashSet<(FileId, EnumMemberId)>>,
    prototype_property_names: OnceLock<FxHashSet<FieldKey>>,
    stores_in_checked_sources: OnceLock<FxHashMap<Atom, Vec<(FileId, ExprId)>>>,
    property_assignments: OnceLock<FxHashMap<Atom, Vec<(FileId, ExprId)>>>,
    property_container_mutations: OnceLock<FxHashMap<Atom, Vec<(FileId, ExprId, ExprId)>>>,
    computed_key_assignments: OnceLock<Vec<(FileId, ExprId)>>,
    union_key_assignments: OnceLock<Vec<(FileId, ExprId)>>,
    union_key_assignments_search: std::sync::Mutex<()>,
    method_assignments_by_name: OnceLock<FxHashMap<Atom, Vec<(FileId, ClassId)>>>,
}

#[derive(Default)]
struct ReifiedNamespaces {
    namespaces: FxHashSet<Sym>,
    variables: FxHashMap<FileId, Vec<SymbolId>>,
}

struct ConstructorFunction {
    function: (FileId, FnId),
    initial_stores: Vec<InitialStore>,
}

struct InitialStore {
    name: Atom,
    parameter: Option<u32>,
    target: ExprId,
}

#[derive(Default)]
struct Discriminants {
    constructor_functions: Vec<ConstructorFunction>,
    candidates: FxHashSet<Atom>,
    mutated: FxHashSet<Atom>,
}

#[derive(Default)]
struct MutablePrototypes {
    every: bool,
    all_since: Option<super::flows::Place>,
    functions: FxHashSet<(FileId, FnId)>,
}

enum NamedFunction {
    Constructor(FileId, FnId),
    Other,
    Unknown,
}

#[derive(Copy, Clone, PartialEq)]
enum PrototypeUse {
    Replaced,
    Escapes,
    Accessed,
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct MethodDeclaration {
    class: (FileId, ClassId),
    is_static: bool,
    is_accessor: bool,
}

type MethodDeclarations = FxHashMap<Atom, Vec<MethodDeclaration>>;

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct MethodStore<T = TypeId> {
    object: T,
    name: Box<[u8]>,
    defines: bool,
}

impl<T> MethodStore<T> {
    pub fn renamed<U>(self, rename: impl FnOnce(T) -> Option<U>) -> Option<MethodStore<U>> {
        Some(MethodStore { object: rename(self.object)?, name: self.name, defines: self.defines })
    }
}

#[derive(Default)]
pub struct ReplacedMethods {
    by_class: FxHashMap<(FileId, ClassId), Vec<(Atom, bool)>>,
    names: FxHashMap<Box<[u8]>, Atom>,
    structural_evidence: FxHashMap<((FileId, ClassId), Atom), Option<Vec<((FileId, ClassId), TypeId)>>>,
}

impl ReplacedMethods {
    pub fn contains(&self, file: FileId, class: ClassId, name: &[u8], is_static: bool) -> bool {
        match (self.by_class.get(&(file, class)), self.names.get(name)) {
            (Some(members), Some(&name)) => members.contains(&(name, is_static)),
            _ => false,
        }
    }

    pub fn structural_evidence(&self, file: FileId, class: ClassId, name: &[u8]) -> Option<&[((FileId, ClassId), TypeId)]> {
        self.structural_evidence.get(&((file, class), *self.names.get(name)?))?.as_deref()
    }
}

#[derive(Copy, Clone)]
enum FieldConflict {
    ComputedName(Place),
    SameName(Place),
    Method((FileId, ClassId)),
}

enum Superclass {
    None,
    Known((FileId, ClassId)),
    Unknown,
}

#[derive(Default)]
struct Hierarchy {
    parent: FxHashMap<(FileId, ClassId), (FileId, ClassId)>,
    children: FxHashMap<(FileId, ClassId), Vec<(FileId, ClassId)>>,
}

impl Hierarchy {
    fn extends(&self, class: (FileId, ClassId), ancestor: (FileId, ClassId)) -> bool {
        let mut at = class;
        for _ in 0..256 {
            match self.parent.get(&at) {
                Some(&parent) if parent == ancestor => return true,
                Some(&parent) => at = parent,
                None => return false,
            }
        }
        false
    }
}

fn skip_assertions(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
        e = expr;
    }
    e
}

fn may_be_number_type(hir: &File, ty: TypeNodeId, type_parameters: &FxHashSet<Atom>) -> bool {
    match hir[ty].kind {
        TypeNodeKind::NumberLit(_) => true,
        TypeNodeKind::Ref { name, args } => args.is_empty() && (name.len() > 1 || name.iter().all(|part| type_parameters.contains(&hir[part].text))),
        TypeNodeKind::Union(parts) => hir.ids(parts).any(|part| may_be_number_type(hir, part, type_parameters)),
        _ => false,
    }
}

#[derive(Default)]
struct FileFacts {
    mentioning_new_target: FxHashSet<FnId>,
    mentioning_super: FxHashSet<FnId>,
    mentioning_this: FxHashSet<FnId>,
    with_uninitialized_this: FxHashSet<FnId>,
    tested_by_private_name: FxHashSet<ClassId>,
}

impl crate::program::Files<'_> {
    pub fn is_decorated_member(&self, file: FileId, member: crate::hir::MemberId) -> bool {
        let hir = self.hir(file);
        hir.legacy_decorators && hir.decorators.iter().any(|&(owner, _)| owner == crate::hir::DecoratorOwner::Member(member))
    }

    pub fn decorated_member(&self, file: FileId, owner: crate::hir::DecoratorOwner) -> Option<crate::hir::MemberId> {
        let bound = self.bound(file);
        match owner {
            crate::hir::DecoratorOwner::Class(_) => None,
            crate::hir::DecoratorOwner::Member(member) => Some(member),
            crate::hir::DecoratorOwner::Param(p) => match bound.fns.get(bound.param_fn[p.idx()].idx()).map(|func| func.owner) {
                Some(FnOwner::Member(member)) => Some(member),
                _ => None,
            },
        }
    }

    pub fn has_decorator(&self, file: FileId, class: crate::hir::ClassId) -> bool {
        let bound = self.bound(file);
        self.hir(file).decorators.iter().any(|&(owner, _)| match owner {
            crate::hir::DecoratorOwner::Class(decorated) => decorated == class,
            _ => self.decorated_member(file, owner).is_some_and(|member| bound.member_owner[member.idx()] == MemberOwner::Class(class)),
        })
    }

    pub fn lowers_decorators(&self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.decorators.is_empty() || !hir.legacy_decorators || hir.is_js {
            return false;
        }
        let emits_metadata = bound.class_options.map_or(self.options.emit_decorator_metadata, |own| own.emit_decorator_metadata);
        hir.decorators.iter().all(|&(owner, _)| {
            if let crate::hir::DecoratorOwner::Class(class) = owner {
                let mut constructors = hir[class].members.iter().filter(|&member| hir[member].kind == crate::hir::MemberKind::Constructor);
                return !emits_metadata || constructors.all(|member| self.has_plain_types(file, member));
            }
            let Some(member) = self.decorated_member(file, owner) else { return false };
            let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return false };
            let m = &hir[member];
            let is_lowered = match m.kind {
                crate::hir::MemberKind::Constructor => true,
                crate::hir::MemberKind::Method | crate::hir::MemberKind::Getter | crate::hir::MemberKind::Setter => self.is_plain_member(file, member),
                crate::hir::MemberKind::Property => self.is_plain_member(file, member) && (m.init.is_none() || self.calls_super_first(file, class)),
                _ => false,
            };
            is_lowered && (!emits_metadata || self.has_plain_types(file, member))
        })
    }

    fn is_plain_member(&self, file: FileId, member: crate::hir::MemberId) -> bool {
        let m = &self.hir(file)[member];
        matches!(m.key, crate::hir::PropKey::Name(_)) && !m.flags.intersects(crate::hir::Flags::STATIC | crate::hir::Flags::AMBIENT | crate::hir::Flags::ABSTRACT | crate::hir::Flags::ACCESSOR)
    }

    fn calls_super_first(&self, file: FileId, class: crate::hir::ClassId) -> bool {
        let hir = self.hir(file);
        let is_super_call = |stmt: crate::hir::StmtId| {
            matches!(hir[stmt].kind, crate::hir::StmtKind::Expr(e) if matches!(hir[e].kind, crate::hir::ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, crate::hir::ExprKind::Super)))
        };
        hir[class].extends.is_none()
            || hir[class].members.iter().filter(|&member| hir[member].kind == crate::hir::MemberKind::Constructor && hir[member].func.is_some()).all(|member| match hir[hir[member].func].body {
                crate::hir::FnBody::Block(stmts) => hir.ids(stmts).any(is_super_call),
                _ => true,
            })
    }

    fn has_plain_types(&self, file: FileId, member: crate::hir::MemberId) -> bool {
        let hir = self.hir(file);
        let m = &hir[member];
        let mut types = vec![m.ty];
        if m.func.is_some() {
            types.extend(hir[m.func].params.iter().map(|p| hir[p].ty));
            types.push(hir[m.func].ret);
        }
        types.into_iter().all(|ty| self.is_plain_type(file, ty))
    }

    fn is_plain_type(&self, file: FileId, ty: crate::hir::TypeNodeId) -> bool {
        use crate::hir::TypeNodeKind as Kind;
        if ty.is_none() {
            return true;
        }
        let hir = self.hir(file);
        match hir[ty].kind {
            Kind::Keyword(keyword) => keyword != crate::hir::Keyword::Intrinsic,
            Kind::Ref { .. } | Kind::StringLit(_) | Kind::NumberLit(_) | Kind::BigIntLit { .. } | Kind::BoolLit(_) | Kind::Template { .. } => true,
            Kind::Array(_) | Kind::Tuple(_) | Kind::Readonly(_) | Kind::Fn(_) | Kind::Object(_) | Kind::Mapped(_) | Kind::Keyof(_) | Kind::Typeof { .. } => true,
            Kind::IndexedAccess { obj, .. } => self.is_plain_type(file, obj),
            Kind::Union(members) | Kind::Intersection(members) => hir.ids(members).all(|member| self.is_plain_type(file, member)),
            _ => false,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct ClassFacts {
    pub has_fixed_layout: bool,
    pub is_evaluated_once: bool,
    pub uses_new_target: bool,
    pub may_return_another_object: bool,
}

impl<'p, 's> Checker<'p, 's> {
    pub fn set_builtin_requires(&self, requires: Vec<((FileId, Atom), FileId)>) {
        self.p.aot.classes.builtin_requires.get_or_init(|| requires.into_iter().collect());
    }

    pub(super) fn has_builtin_requires(&self) -> bool {
        self.p.aot.classes.builtin_requires.get().is_some()
    }

    pub(crate) fn required_builtin_module(&self, file: FileId, e: ExprId) -> Option<FileId> {
        self.files.module(file).builtin?;
        let specifier = crate::bind::required_specifier(self.hir(file), e)?;
        self.p.aot.classes.builtin_requires.get()?.get(&(file, specifier)).copied()
    }

    pub fn is_reified_namespace(&self, namespace: Sym) -> bool {
        self.reified_namespaces().namespaces.contains(&namespace)
    }

    pub(super) fn reified_namespace_variables(&self, file: FileId) -> &'p [SymbolId] {
        self.reified_namespaces().variables.get(&file).map_or(&[], |variables| &variables[..])
    }

    pub fn has_reified_namespaces(&self) -> bool {
        !self.reified_namespaces().namespaces.is_empty()
    }

    pub fn is_within_declaring_block(&self, file: FileId, e: ExprId, member: Sym) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut around: Vec<ModuleId> = Vec::new();
        let mut at = bound.expr_parent[e.idx()];
        while !matches!(at, Parent::None | Parent::File) {
            if let Parent::Module(block) = at {
                around.push(block);
                at = Parent::Stmt(hir[block].stmt);
            }
            at = self.parent_of_node(file, at);
        }
        self.files().decls_of(member).iter().copied().filter(|declared| declared.0 == file).any(|(_, decl)| {
            let stmt = match decl {
                Decl::Fn(func) => match bound.fns[func.idx()].owner {
                    FnOwner::Stmt(stmt) => stmt,
                    _ => return false,
                },
                Decl::Class(class) => match bound.class_owner[class.idx()] {
                    ClassOwner::Stmt(stmt) => stmt,
                    ClassOwner::Expr(_) => return false,
                },
                Decl::Enum(declaration) => hir[declaration].stmt,
                Decl::Module(declaration) => hir[declaration].stmt,
                _ => return false,
            };
            matches!(bound.stmt_parent[stmt.idx()], Parent::Module(block) if around.contains(&block))
        })
    }

    pub fn is_enum_member_read_from_object(&self, reader: FileId, of: FileId, member: EnumMemberId) -> bool {
        reader != of && self.p.aot.classes.reassigned_enum_members.get_or_init(|| self.find_reassigned_enum_members()).contains(&(of, member))
    }

    fn find_reassigned_enum_members(&self) -> FxHashSet<(FileId, EnumMemberId)> {
        let files = self.files();
        let mut found = FxHashSet::default();
        let mut add = |member: Sym| {
            found.extend(files.decls_of(member).iter().filter_map(|&(of, decl)| match decl {
                Decl::EnumMember(member) => Some((of, member)),
                _ => None,
            }));
        };
        for file in self.files_declaring_classes() {
            let (hir, bound, index) = (self.hir(file), self.bound(file), self.file_exprs_by_kind(file));
            for &e in index.of(ExprTag::Dot).iter().chain(index.of(ExprTag::Index)) {
                let is_deleted = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                if !is_deleted && bound.get_assignment_target(hir, e).is_none() {
                    continue;
                }
                let (obj, name) = match hir[e].kind {
                    ExprKind::Dot { obj, name, .. } => (obj, Some(name)),
                    ExprKind::Index { obj, index, .. } => match hir[index].kind {
                        ExprKind::String(name) => (obj, Some(name)),
                        ExprKind::Number(_) => continue,
                        _ => (obj, None),
                    },
                    _ => continue,
                };
                let Some(declared) = self.enum_for_expr(file, obj) else { continue };
                match name {
                    Some(name) => files.export(declared, name).into_iter().for_each(&mut add),
                    None => files.exports(declared).into_iter().for_each(|(_, member)| add(member)),
                }
            }
            for &e in index.of(ExprTag::Call) {
                let ExprKind::Call(call) = hir[e].kind else { continue };
                if !matches!(self.global_method_names(file, call), Some((b"Object", b"assign" | b"defineProperty" | b"defineProperties") | (b"Reflect", b"set" | b"defineProperty" | b"deleteProperty"))) {
                    continue;
                }
                if let Some(declared) = hir.ids(hir[call].args).next().and_then(|target| self.enum_for_expr(file, target)) {
                    files.exports(declared).into_iter().for_each(|(_, member)| add(member));
                }
            }
        }
        found
    }

    fn enum_for_expr(&self, file: FileId, e: ExprId) -> Option<Sym> {
        self.declaration_for_path(file, e).filter(|&declared| self.files().flags(declared).intersects(SymFlags::ENUM))
    }

    fn declaration_for_path(&self, file: FileId, e: ExprId) -> Option<Sym> {
        let (hir, files) = (self.hir(file), self.files());
        let e = skip_assertions(hir, e);
        let named = match hir[e].kind {
            ExprKind::Ident(name) => self.resolve_identifier(file, e, name, true).ok().flatten()?,
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => files.export(self.declaration_for_path(file, obj)?, name)?,
            _ => return None,
        };
        if files.flags(named).contains(SymFlags::ALIAS) { files.resolve_alias(named) } else { Some(named) }
    }

    fn reified_namespaces(&self) -> &'p ReifiedNamespaces {
        self.p.aot.classes.reified_namespaces.get_or_init(|| self.find_reified_namespaces())
    }

    fn find_reified_namespaces(&self) -> ReifiedNamespaces {
        let files = self.files();
        let code = self.files_declaring_classes();
        let mut by_name: FxHashMap<Atom, Vec<Sym>> = FxHashMap::default();
        let mut found = ReifiedNamespaces::default();
        for &file in code.iter().filter(|&&file| self.is_compiled(file)) {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (m, module) in hir.modules.iter().enumerate() {
                let m = ModuleId(m as u32);
                if module.flags.contains(Flags::AMBIENT) || !bound.is_instantiated_module(m, true) {
                    continue;
                }
                let namespace = files.export_symbol_of_value_symbol_if_exported(files.sym(file, bound.module_symbol[m.idx()]));
                if files.flags(namespace).intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM) {
                    found.namespaces.insert(namespace);
                    continue;
                }
                let named = by_name.entry(files.symbol(namespace).name).or_default();
                if !named.contains(&namespace) {
                    named.push(namespace);
                }
            }
        }
        if by_name.is_empty() && found.namespaces.is_empty() {
            return found;
        }
        let is_candidate = |sym: Sym| by_name.get(&files.symbol(sym).name).is_some_and(|named| named.contains(&sym));
        let mut is_module_object_created = false;
        for &file in &code {
            let (hir, bound, index) = (self.hir(file), self.bound(file), self.file_exprs_by_kind(file));
            let is_object_of_access = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Dot { obj, chain: Chain::No, .. } if obj == e));
            is_module_object_created |= !index.of(ExprTag::ImportCall).is_empty() || index.of(ExprTag::Call).iter().any(|&e| crate::bind::required_specifier(hir, e).is_some() || !hir.folded_require_specifiers(e).is_empty());
            is_module_object_created |= self.atoms().lookup(b"createRequire").is_some_and(|create_require| hir.import_specs.iter().any(|spec| spec.imported == create_require) || index.of(ExprTag::Dot).iter().any(|&e| matches!(hir[e].kind, ExprKind::Dot { name, .. } if name == create_require)));
            for &e in index.of(ExprTag::Ident) {
                let Some(symbol) = bound.symbols.get(bound.expr_symbol[e.idx()].idx()) else { continue };
                if !symbol.flags.intersects(SymFlags::VALUE_MODULE | SymFlags::ALIAS) || bound.is_in_type_query(e) {
                    continue;
                }
                let sym = files.export_symbol_of_value_symbol_if_exported(files.sym(file, bound.expr_symbol[e.idx()]));
                let Some(sym) = (if files.flags(sym).contains(SymFlags::ALIAS) { files.resolve_alias(sym) } else { Some(sym) }) else { continue };
                if matches!(files.value_declaration(sym), Some((_, Decl::File))) {
                    is_module_object_created = true;
                } else if is_candidate(sym) {
                    found.namespaces.insert(sym);
                }
            }
            for &e in index.of(ExprTag::Dot) {
                if let ExprKind::Dot { name, .. } = hir[e].kind
                    && let Some(named) = by_name.get(&name)
                    && !is_object_of_access(e)
                {
                    found.namespaces.extend(named);
                }
            }
            let mut aliases = None;
            for (import, declared) in hir.import_equals.iter().enumerate() {
                let ImportEqualsTarget::Entity(names) = declared.target else { continue };
                if declared.flags.contains(Flags::AMBIENT) || matches!(bound.stmt_parent[declared.stmt.idx()], Parent::None) {
                    continue;
                }
                let aliases = aliases.get_or_insert_with(|| self.symbols_of_alias_declarations(file));
                if !aliases.get(&Decl::ImportEquals(ImportEqualsId(import as u32))).is_some_and(|&alias| files.symbol_flags(alias).intersects(SymFlags::VALUE)) {
                    continue;
                }
                let names: Vec<Atom> = hir.texts(names).collect();
                for length in 1..=names.len() {
                    let Some(named) = files.resolve_entity(file, bound.import_equals_scope[import], &names[..length], SymFlags::NAMESPACE) else { break };
                    let named = files.export_symbol_of_value_symbol_if_exported(named);
                    let Some(named) = (if files.flags(named).contains(SymFlags::ALIAS) { files.resolve_alias(named) } else { Some(named) }) else { break };
                    if is_candidate(named) && !self.namespace_runs_before_import_equals(named, file, ImportEqualsId(import as u32)) {
                        found.namespaces.insert(named);
                    }
                }
            }
        }
        if is_module_object_created {
            for &file in &code {
                for (_, exported) in files.each_export(files.file_symbol(file)) {
                    let exported = if files.flags(exported).contains(SymFlags::ALIAS) { files.resolve_alias(exported) } else { Some(exported) };
                    found.namespaces.extend(exported.filter(|&sym| is_candidate(sym)));
                }
            }
        }
        let mut pending: Vec<Sym> = found.namespaces.iter().copied().collect();
        while let Some(namespace) = pending.pop() {
            for (_, member) in files.each_export(namespace) {
                let held = if files.flags(member).contains(SymFlags::ALIAS) { files.resolve_alias(member) } else { Some(member) };
                if let Some(held) = held.filter(|&held| is_candidate(held) && found.namespaces.insert(held)) {
                    pending.push(held);
                }
                for &(file, decl) in files.decls_of(member).iter() {
                    if matches!(decl, Decl::Var(_)) {
                        found.variables.entry(file).or_default().push(self.bound(file).symbol_of_declaration(decl));
                    }
                }
            }
        }
        found
    }

    fn is_type_only_import(&self, sym: Sym) -> bool {
        self.files().flags(sym).contains(SymFlags::ALIAS)
            && self.files().decls_of(sym).iter().all(|&(of, decl)| {
                let hir = self.hir(of);
                match decl {
                    Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].type_only,
                    Decl::ImportSpec(spec) => hir[spec].type_only || hir[hir[spec].import].type_only,
                    _ => false,
                }
            })
    }

    fn value_import_named(&self, file: FileId, name: Atom) -> Option<Sym> {
        let is_import = |decl: &Decl| matches!(decl, Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_));
        let named = self.bound(file).symbols.iter().enumerate().filter(|(_, symbol)| symbol.name == name && symbol.flags.contains(SymFlags::ALIAS) && symbol.decls.iter().all(is_import));
        named.map(|(index, _)| self.files().sym(file, SymbolId(index as u32))).find(|&sym| !self.is_type_only_import(sym))
    }

    pub fn identifier_binding(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let local = self.bound(file).expr_symbol[e.idx()];
        if local.is_some() && self.is_type_only_import(self.files().sym(file, local)) {
            return self.value_import_named(file, name).or_else(|| self.files().global(name, SymFlags::VALUE).filter(|&global| !self.is_type_only_import(global)));
        }
        if self.hir(file).is_js && local.is_some() {
            let own = self.files().sym(file, local);
            let flags = self.files().flags(own);
            if flags.contains(SymFlags::ALIAS)
                && !flags.intersects(SymFlags::VALUE)
                && !self.files().means(own, SymFlags::VALUE)
                && let Some(target) = self.files().resolve_alias(own)
            {
                let declared: Vec<FileId> = self.files().decls_of(target).iter().copied().map(|(of, _)| of).collect();
                if declared.iter().any(|&of| self.hir(of).kind == FileKind::Declaration) {
                    return Some(own);
                }
            }
        }
        self.symbol_of_identifier(file, e, name)
    }

    pub fn is_primitive_wrapper(&mut self, ty: TypeId) -> bool {
        let TypeData::Intersection(parts) = self.data(ty) else { return false };
        parts.to_vec().into_iter().any(|part| {
            self.is_object_type(part)
                && (self.class_for_type(part, false).is_some() || self.members(part).is_some_and(|members| members.shape().props.iter().any(|prop| prop.flags.contains(PropFlags::METHOD))))
        })
    }

    pub fn parameters_passed_untyped(&mut self, file: FileId, func: FnId) -> Vec<usize> {
        let own = self.hir(file)[func].params;
        if !own.iter().any(|p| self.hir(file)[p].ty.is_some()) {
            return Vec::new();
        }
        let Some(expected) = self.contextual_signature(file, func) else { return Vec::new() };
        let expected = self.sig_params(expected);
        (0..own.len())
            .filter(|&index| {
                let p = &self.hir(file)[own.at(index)];
                p.ty.is_some() && !p.flags.contains(Flags::REST) && self.param_type_at(&expected, index).is_some_and(|handed| self.is_untyped(handed))
            })
            .collect()
    }

    pub fn promise_fulfillment_type(&mut self, file: FileId, func: FnId, e: ExprId) -> Option<TypeId> {
        self.annotated_result_element_type(file, func, e, false)
    }

    pub fn generator_yield_type(&mut self, file: FileId, func: FnId, e: ExprId) -> Option<TypeId> {
        self.annotated_result_element_type(file, func, e, true)
    }

    fn annotated_result_element_type(&mut self, file: FileId, func: FnId, e: ExprId, is_produced: bool) -> Option<TypeId> {
        if func.is_none() {
            return None;
        }
        let f = &self.hir(file)[func];
        let (is_async, is_generator) = (f.flags.contains(Flags::ASYNC), f.flags.contains(Flags::GENERATOR));
        if f.ret.is_none() || !is_async && !is_generator || is_produced && !is_generator {
            return None;
        }
        let own = self.type_of_expr(file, e);
        if self.is_untyped(own) || is_async && self.awaited(own) != own {
            return None;
        }
        let declared = self.return_type_of_fn(file, func);
        let written = if is_generator {
            let types = self.iteration_types(declared, is_async)?;
            if is_produced { types.yielded } else { types.returned }
        } else {
            self.awaited(declared)
        };
        (written != declared && !self.is_uninformative(written)).then_some(written)
    }

    pub fn is_spread_part(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Prop(prop) => return hir[prop].kind == PropKind::Spread,
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, .. } | ExprKind::Cond { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::Await(_) => parent,
                    ExprKind::Call(call) if hir[call].callee == at && matches!(hir[at].kind, ExprKind::Fn(_)) => parent,
                    _ => return false,
                },
                Parent::FnBody(func) => match bound.fns[func.idx()].owner {
                    FnOwner::Expr(written) => written,
                    _ => return false,
                },
                Parent::Stmt(stmt) if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_)) => match self.enclosing_fn(file, Parent::Stmt(stmt)).map(|func| bound.fns[func.idx()].owner) {
                    Some(FnOwner::Expr(written)) => written,
                    _ => return false,
                },
                _ => return false,
            };
        }
    }

    fn redeclared_parameter_symbols(&self, file: FileId, func: FnId) -> Vec<SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if !f.params.iter().any(|p| hir[p].default.is_some() || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_))) {
            return Vec::new();
        }
        let mut pats: Vec<PatId> = f.params.iter().map(|p| hir[p].pat).collect();
        let mut redeclared: Vec<SymbolId> = Vec::new();
        while let Some(pat) = pats.pop() {
            match hir[pat].kind {
                PatKind::Missing => {}
                PatKind::Ident(_) => {
                    let id = bound.pat_symbol[pat.idx()];
                    if id.is_some() && bound.symbols[id.idx()].decls.as_slice().iter().any(|decl| matches!(decl, Decl::Var(_) | Decl::Fn(_))) {
                        redeclared.push(id);
                    }
                }
                PatKind::Object(props) => pats.extend(props.iter().map(|p| hir[p].value)),
                PatKind::Array(elems) => pats.extend(elems.iter().map(|e| hir[e].pat)),
            }
        }
        redeclared
    }

    pub fn redeclared_parameters(&mut self, file: FileId, func: FnId) -> Vec<(Sym, u32, u32)> {
        let hir = self.hir(file);
        let f = &hir[func];
        let FnBody::Block(stmts) = f.body else { return Vec::new() };
        let (Some(first_parameter), Some(first_statement)) = (f.params.iter().next(), hir.ids(stmts).next()) else { return Vec::new() };
        let redeclared = self.redeclared_parameter_symbols(file, func);
        if redeclared.is_empty() {
            return Vec::new();
        }
        let (start, end) = (hir[first_parameter].pos, hir[first_statement].start);
        let mut transitive_closure: Vec<(Sym, u32, u32)> = Vec::new();
        for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            let ExprKind::Ident(name) = hir[e].kind else { continue };
            if !(start..end).contains(&hir[e].pos) || self.enclosing_fn_of_expr(file, e) == Some(func) {
                continue;
            }
            let resolved = self.resolve_identifier(file, e, name, true).ok().flatten();
            if let Some(sym) = resolved
                && sym.file == file
                && redeclared.contains(&sym.id)
                && !transitive_closure.iter().any(|found| found.0 == sym)
            {
                transitive_closure.push((sym, start, end));
            }
        }
        transitive_closure
    }

    pub fn is_ambient_interface(&self, interface: Sym) -> bool {
        let declarations = self.files().decls(interface);
        declarations.iter().any(|(_, decl)| matches!(decl, Decl::Interface(_)))
            && declarations.into_iter().all(|(file, decl)| {
                let hir = self.hir(file);
                !matches!(decl, Decl::Class(_)) && (hir.kind == FileKind::Declaration || hir.is_ambient(hir.node(decl)))
            })
    }

    pub fn is_declared_ambient(&self, sym: Sym) -> bool {
        self.files().value_declaration(sym).is_some_and(|(file, decl)| {
            let hir = self.hir(file);
            hir.kind == FileKind::Declaration || hir.is_ambient(hir.node(decl))
        })
    }

    pub fn const_enum_object_type(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let ty = self.type_of_expr(file, e);
        match *self.data(ty) {
            TypeData::Anon { origin: Origin::EnumObject(declared), .. } if self.files().flags(declared).contains(SymFlags::CONST_ENUM) => Some(declared),
            _ => None,
        }
    }

    pub fn returns_no_value(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        matches!(hir[func].body, FnBody::Block(_))
            && !hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && bound.ids(bound.fns[func.idx()].returns).all(|stmt: StmtId| !matches!(hir[stmt].kind, StmtKind::Return(value) if value.is_some()))
    }

    pub fn never_returns(&mut self, file: FileId, func: FnId) -> bool {
        let bound = self.bound(file);
        let (end, has_return) = (bound.fns[func.idx()].end, bound.ids::<StmtId>(bound.fns[func.idx()].returns).next().is_some());
        !has_return && self.returns_no_value(file, func) && (end == UNREACHABLE || (end.is_some() && !self.is_reachable(file, end)))
    }

    pub fn is_passed_to_any_or_unknown_parameter(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return false };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return false };
        if hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(index) = hir.ids(hir[call].args).position(|argument| argument == e) else { return false };
        let Some(sig) = self.resolved_signature(file, parent).sig else {
            let callee = self.type_of_expr(file, hir[call].callee);
            return self.is_uninformative(callee);
        };
        let parameters = self.sig_params(sig);
        self.param_type_at(&parameters, index).is_some_and(|taking| self.is_uninformative(taking))
    }

    pub fn spread_type_exceeds_copied_properties(&mut self, file: FileId, e: ExprId) -> bool {
        let operand = self.type_of_expr(file, e);
        let operand = self.non_nullable(operand);
        self.parts(operand).iter().copied().any(|part| match *self.data(part) {
            TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => true,
            TypeData::Ref { target, .. } => self.files().module(target.file).is_lib || self.is_array_like(part) || self.extended_built_in(part).is_some() || self.is_declared_only_record(part),
            _ => self.is_declared_only_record(part),
        })
    }

    pub fn is_checked_against_inferred_type(&mut self, file: FileId, e: ExprId, expected: TypeId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !self.has_any_where_type_is_expected(file, e, expected) {
            return false;
        }
        let mut argument = e;
        let (call, parent) = loop {
            let parent = match bound.expr_parent[argument.idx()] {
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread && bound.prop_owner[prop.idx()].is_some() => bound.prop_owner[prop.idx()],
                Parent::Expr(parent) if parent.is_some() => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee != argument => break (call, parent),
                ExprKind::Object(_) | ExprKind::Array(_) => argument = parent,
                _ => return false,
            }
        };
        if hir.ids(hir[call].type_args).next().is_some() || hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(index) = hir.ids(hir[call].args).position(|it| it == argument) else { return false };
        let Some(sig) = self.resolved_signature(file, parent).sig else { return false };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else { return false };
        if self.files().module(declared_in).is_lib {
            return false;
        }
        let declared = self.sig_of_fn(declared_in, func);
        let (declared, called) = (self.sig_params(declared), self.sig_params(sig));
        matches!((self.param_type_at(&declared, index), self.param_type_at(&called, index)), (Some(declared), Some(called)) if declared != called)
    }

    fn has_any_where_type_is_expected(&mut self, file: FileId, e: ExprId, expected: TypeId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(props) => props.iter().any(|p| {
                let PropKey::Name(name) = hir[p].key else { return false };
                if !matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) {
                    return false;
                }
                let Some(declared) = self.type_of_property(expected, name).filter(|&declared| !self.is_uninformative(declared)) else { return false };
                self.type_of_expr(file, hir[p].value).is_any() || self.has_any_where_type_is_expected(file, hir[p].value, declared)
            }),
            ExprKind::Array(elements) => match self.index_type_of_type(expected, TypeId::NUMBER) {
                Some(declared) => hir.ids(elements).any(|element| self.has_any_where_type_is_expected(file, element, declared)),
                None => false,
            },
            _ => false,
        }
    }

    pub fn class_facts(&mut self, file: FileId, class: ClassId, base: Option<ClassFacts>, extended: &[(FileId, ClassId)]) -> ClassFacts {
        let found = self.file_class_facts(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let c = &hir[class];
        let constructor = self.class_constructor(file, class);
        let is_initialized_in_order = !constructor.is_some_and(|func| found.with_uninitialized_this.contains(&func));
        let is_evaluated_once = self.is_evaluated_once(file, bound.class_owner[class.idx()].to_parent()) && !self.is_class_named_by_computed_key(file, class);
        let has_fixed_layout = is_evaluated_once && !self.is_untyped_file(file) && !self.files().has_decorator(file, class) && (c.extends.is_none() || base.is_some_and(|base| base.has_fixed_layout) && is_initialized_in_order) && {
            let instances = self.class_instance_type(file, class);
            !self.may_be_redefined(instances)
        } && {
            let constructing: Vec<(FileId, ClassId)> = std::iter::once((file, class)).chain(extended.iter().copied()).collect();
            !found.tested_by_private_name.contains(&class) || self.this_never_escapes_construction(&constructing)
        };
        let base = base.filter(|_| has_fixed_layout);
        let mentions_new_target = constructor.is_some_and(|func| found.mentioning_new_target.contains(&func));
        let returns_value = constructor.is_some_and(|func| bound.ids(bound.fns[func.idx()].returns).any(|stmt| matches!(hir[stmt].kind, StmtKind::Return(value) if value.is_some())));
        ClassFacts {
            has_fixed_layout,
            is_evaluated_once,
            uses_new_target: mentions_new_target || c.extends.is_some() && !has_fixed_layout || base.is_some_and(|base| base.uses_new_target),
            may_return_another_object: returns_value || base.is_some_and(|base| base.may_return_another_object),
        }
    }

    pub fn implemented_optional_properties(&mut self, file: FileId, class: ClassId) -> Vec<(TypeId, Atom)> {
        let hir = self.hir(file);
        let instances = self.class_instance_type(file, class);
        let mut found: Vec<(TypeId, Atom, Option<TypeId>)> = Vec::new();
        for node in hir.ids(hir[class].implements) {
            let implemented = self.type_from_node(file, node);
            let Some(members) = self.members(implemented) else { continue };
            for prop in members.shape().props.iter() {
                if !prop.flags.contains(PropFlags::OPTIONAL) || prop.flags.contains(PropFlags::ACCESSOR) || self.type_of_property(instances, prop.name).is_some() {
                    continue;
                }
                let ty = self.type_of_prop(prop, members.mapper);
                match found.iter_mut().find(|known| known.1 == prop.name) {
                    Some(known) if known.2 != Some(ty) => known.2 = None,
                    Some(_) => {}
                    None => found.push((implemented, prop.name, Some(ty))),
                }
            }
        }
        found.retain(|known| known.2.is_some());
        if found.is_empty() {
            return Vec::new();
        }
        let class = (file, class);
        let Ok(computed_names) = self.constant_computed_method_names(class) else { return Vec::new() };
        found.retain(|known| !computed_names.iter().any(|computed| computed.0 == known.1));
        let declaring = self.method_declarations_by_name();
        found.retain(|known| {
            let declarations = declaring.get(&known.1).map_or(&[][..], |declarations| &declarations[..]);
            !declarations.iter().any(|declaration| !declaration.is_static && self.may_extend(declaration.class, class))
        });
        found.into_iter().map(|(implemented, name, _)| (implemented, name)).collect()
    }

    fn constant_computed_method_names(&mut self, class: (FileId, ClassId)) -> Result<Vec<(Atom, Place)>, Place> {
        let mut names = Vec::new();
        for &(of, key) in self.computed_methods() {
            if !self.is_untyped_file(of.0) && self.is_symbol_name(of.0, key) {
                continue;
            }
            if of != class && !self.is_declared_to_extend(of, class) && !self.may_extend(class, of) {
                continue;
            }
            let at = Place { file: of.0, pos: self.hir(of.0)[key].pos };
            let Some(Primitive::String(name)) = self.constant_value_of(of.0, key) else { return Err(at) };
            names.push((name, at));
        }
        Ok(names)
    }

    pub fn declared_only_properties(&mut self, file: FileId, class: ClassId) -> Vec<Atom> {
        self.declared_only_fields(file, class).into_iter().filter(|field| field.1.is_none()).map(|field| field.0).collect()
    }

    fn declared_only_fields(&mut self, file: FileId, class: ClassId) -> Vec<(Atom, Option<FieldConflict>)> {
        let instances = self.class_instance_type(file, class);
        let inherited = match self.resolve_superclass(file, class) {
            Superclass::None => None,
            Superclass::Known((file, class)) => Some(self.class_instance_type(file, class)),
            Superclass::Unknown => return Vec::new(),
        };
        let Some(members) = self.members(instances) else { return Vec::new() };
        let mut found: Vec<Atom> = Vec::new();
        for prop in members.shape().props.iter() {
            let PropSource::Symbol(declared) = prop.source else { continue };
            if !prop.flags.intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                && self.is_declared_only_member(declared)
                && !inherited.is_some_and(|inherited| self.type_of_property(inherited, prop.name).is_some())
            {
                found.push(prop.name);
            }
        }
        if found.is_empty() {
            return Vec::new();
        }
        let class = (file, class);
        let computed_names = self.constant_computed_method_names(class);
        let declaring = self.method_declarations_by_name();
        let conflict_with = |c: &mut Self, name: Atom| {
            match &computed_names {
                Err(at) => return Some(FieldConflict::ComputedName(*at)),
                Ok(names) => {
                    if let Some(computed) = names.iter().find(|computed| computed.0 == name) {
                        return Some(FieldConflict::SameName(computed.1));
                    }
                }
            }
            let declarations = declaring.get(&name).map_or(&[][..], |declarations| &declarations[..]);
            let method = declarations.iter().find(|declaration| {
                !declaration.is_static && (declaration.class == class || c.may_extend(declaration.class, class) || c.may_extend(class, declaration.class))
            })?;
            Some(FieldConflict::Method(method.class))
        };
        found.into_iter().map(|name| (name, conflict_with(self, name))).collect()
    }

    pub fn assigns_fields(&self, file: FileId, class: ClassId) -> bool {
        let hir = self.hir(file);
        self.bound(file).class_options.map_or(self.files().options.specified_use_define_for_class_fields == Some(false), |own| !own.use_define_for_class_fields)
            && !hir.is_js
            && self.files().module(file).builtin.is_none()
            && !hir[class].members.iter().any(|member| {
                let m = &hir[member];
                m.kind == MemberKind::Property && !m.flags.intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT) && matches!(m.key, PropKey::Computed(_))
            })
    }

    pub fn is_field_omitted(&self, file: FileId, member: MemberId) -> bool {
        let m = &self.hir(file)[member];
        m.kind == MemberKind::Property
            && m.init.is_none()
            && !m.flags.intersects(Flags::STATIC | Flags::ACCESSOR)
            && matches!(m.key, PropKey::Name(_))
            && matches!(self.bound(file).member_owner[member.idx()], MemberOwner::Class(class) if self.assigns_fields(file, class) || self.files().is_decorated_member(file, member))
    }

    fn is_declared_only_member(&self, member: Sym) -> bool {
        let declarations = self.files.decls(member);
        !declarations.is_empty()
            && declarations.into_iter().all(|(file, decl)| {
                let Decl::Member(m) = decl else { return false };
                let m_of = &self.hir(file)[m];
                match self.bound(file).member_owner[m.idx()] {
                    MemberOwner::Interface(_) => true,
                    MemberOwner::Class(_) => m_of.kind == MemberKind::Property && (m_of.flags.contains(Flags::AMBIENT) || self.is_field_omitted(file, m)) && !m_of.flags.contains(Flags::STATIC),
                    _ => false,
                }
            })
    }

    fn resolve_superclass(&mut self, file: FileId, class: ClassId) -> Superclass {
        if self.hir(file)[class].extends.is_none() {
            return Superclass::None;
        }
        if self.bound(file).class_symbol[class.idx()].is_none() {
            return Superclass::Unknown;
        }
        let symbol = self.class_sym(file, class);
        self.base_types(symbol).into_vec().into_iter().find_map(|base| self.class_for_type(base, false)).map_or(Superclass::Unknown, Superclass::Known)
    }

    fn is_declared_to_extend(&mut self, mut class: (FileId, ClassId), ancestor: (FileId, ClassId)) -> bool {
        for _ in 0..256 {
            match self.resolve_superclass(class.0, class.1) {
                Superclass::None | Superclass::Unknown => return false,
                Superclass::Known(superclass) if superclass != ancestor => class = superclass,
                Superclass::Known(_) => return true,
            }
        }
        true
    }

    fn may_extend(&mut self, mut class: (FileId, ClassId), ancestor: (FileId, ClassId)) -> bool {
        for _ in 0..256 {
            match self.resolve_superclass(class.0, class.1) {
                Superclass::None => return false,
                Superclass::Known(superclass) if superclass != ancestor => class = superclass,
                Superclass::Known(_) => return true,
                Superclass::Unknown => return self.may_be_extended_by_value(&[class], &[ancestor])[0],
            }
        }
        true
    }

    pub fn class_constructor(&self, file: FileId, class: ClassId) -> Option<FnId> {
        let hir = self.hir(file);
        (hir[class].members.iter())
            .map(|member| &hir[member])
            .find(|m| m.kind == MemberKind::Constructor && m.func.is_some() && !matches!(hir[m.func].body, FnBody::None))
            .map(|m| m.func)
    }

    pub fn class_for_const(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        let (file, Decl::Var(pat)) = self.files.value_declaration(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
        let declaration = &hir[d];
        if declaration.kind != VarKind::Const || declaration.flags.contains(Flags::AMBIENT) || declaration.ty.is_some() || declaration.init.is_none() {
            return None;
        }
        let ExprKind::Class(class) = hir[declaration.init].kind else { return None };
        self.is_evaluated_once(file, Parent::Expr(declaration.init)).then_some((file, class))
    }

    pub fn extends_global_promise(&mut self, file: FileId, class: ClassId) -> bool {
        let Some(promise) = self.atoms().lookup(b"Promise").and_then(|name| self.files().global(name, SymFlags::VALUE)) else { return false };
        if !self.files().decls_of(promise).iter().all(|&(of, _)| self.files().module(of).is_lib) {
            return false;
        }
        let (mut file, mut e) = (file, self.hir(file)[class].extends);
        for _ in 0..4 {
            let hir = self.hir(file);
            if e.is_none() {
                return false;
            }
            e = skip_assertions(hir, e);
            let name = match hir[e].kind {
                ExprKind::Instantiation { expr, .. } => {
                    e = expr;
                    continue;
                }
                ExprKind::Ident(name) => name,
                _ => return false,
            };
            let Some(sym) = self.identifier_binding(file, e, name) else { return false };
            if sym == promise {
                return true;
            }
            let Some(initializer) = self.initializer_of_const(sym) else { return false };
            (file, e) = initializer;
        }
        false
    }

    pub fn class_for_variable(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        let (file, decl) = self.files.value_declaration(sym)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Class(class) => {
                let local = bound.symbol_of_declaration(decl).some()?;
                let is_assigned = self.files.flags(sym).contains(SymFlags::ASSIGNED)
                    || bound.symbols[local.idx()].flags.contains(SymFlags::ASSIGNED)
                    || !bound.assignments_to(local).is_empty()
                    || self.is_stored_through_assertions(file, local)
                    || self.files.has_decorator(file, class);
                let is_file_private = self.files.module(file).is_module() || self.enclosing_fn(file, bound.class_owner[class.idx()].to_parent()).is_some();
                (!hir[class].flags.contains(Flags::AMBIENT) && !is_assigned && is_file_private).then_some((file, class))
            }
            Decl::Var(pat) => {
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
                let declaration = &hir[d];
                if declaration.kind != VarKind::Const || declaration.flags.contains(Flags::AMBIENT) || declaration.init.is_none() {
                    return None;
                }
                let ExprKind::Class(class) = hir[skip_assertions(hir, declaration.init)].kind else { return None };
                Some((file, class))
            }
            _ => None,
        }
    }

    pub(super) fn is_class_named_by_computed_key(&self, file: FileId, class: ClassId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ClassOwner::Expr(mut e) = bound.class_owner[class.idx()] else { return false };
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Expr(around) if matches!(hir[around].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Instantiation { .. }) => e = around,
                _ => break,
            }
        }
        hir[class].name.is_none()
            && match bound.expr_parent[e.idx()] {
                Parent::Prop(prop) => matches!(hir[prop].key, PropKey::Computed(_)),
                Parent::MemberInit(member) => matches!(hir[member].key, PropKey::Computed(_)),
                _ => false,
            }
    }

    pub(super) fn parent_by_evaluation(&self, file: FileId, at: Parent) -> Parent {
        let bound = self.bound(file);
        match at {
            Parent::MemberKey(member) => match bound.member_owner[member.idx()] {
                MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                _ => self.parent_of_node(file, at),
            },
            Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
            Parent::MethodKey(prop) => Parent::Expr(bound.prop_owner[prop.idx()]),
            _ => self.parent_of_node(file, at),
        }
    }

    pub(super) fn evaluating_function(&self, file: FileId, mut at: Parent) -> Option<FnId> {
        let bound = self.bound(file);
        loop {
            at = match at {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return Some(func),
                Parent::ParamDefault(p) => return Some(bound.param_fn[p.idx()]),
                Parent::None | Parent::File => return None,
                _ => self.parent_by_evaluation(file, at),
            };
        }
    }

    pub fn is_evaluated_once(&self, file: FileId, node: Parent) -> bool {
        self.first_repeating_ancestor(file, node).is_none()
    }

    fn first_repeating_ancestor(&self, file: FileId, node: Parent) -> Option<Parent> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = node;
        loop {
            at = match at {
                Parent::File => return None,
                Parent::None | Parent::FnBody(_) | Parent::ParamDefault(_) => return Some(at),
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => {
                    let is_loop = matches!(
                        hir[s].kind,
                        StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. }
                    );
                    if is_loop {
                        return Some(at);
                    }
                    bound.stmt_parent[s.idx()]
                }
                Parent::MemberInit(m) if !hir[m].flags.contains(Flags::STATIC) => return Some(at),
                Parent::MemberKey(m) | Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return Some(at),
                },
                Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
                _ => self.parent_of_node(file, at),
            };
        }
    }

    pub fn is_symbol_name(&mut self, file: FileId, name: ExprId) -> bool {
        let ty = self.type_of_expr(file, name);
        self.is_symbol_like(ty)
    }

    pub fn may_be_extended_by_value(&mut self, extending: &[(FileId, ClassId)], candidates: &[(FileId, ClassId)]) -> Vec<bool> {
        let mut extended: Vec<TypeId> = Vec::new();
        let (mut is_anything_extended, mut is_anything_extended_in_the_runtime) = (false, false);
        for &(file, class) in extending {
            let mut ty = self.type_of_expr(file, self.hir(file)[class].extends);
            if self.is_instantiable(ty) {
                ty = self.base_constraint(ty);
            }
            if self.files.module(file).builtin.is_some() {
                is_anything_extended_in_the_runtime |= self.is_uninformative(ty);
            } else {
                is_anything_extended |= self.is_uninformative(ty);
            }
            if !self.is_uninformative(ty) && !extended.contains(&ty) {
                extended.push(ty);
            }
        }
        (candidates.iter())
            .map(|&(file, class)| {
                let symbol = self.files.sym(file, self.bound(file).class_symbol[class.idx()]);
                let class_object = self.type_of_symbol(symbol);
                is_anything_extended || is_anything_extended_in_the_runtime && self.files.module(file).builtin.is_some() || extended.iter().any(|&extended| self.is_assignable(class_object, extended))
            })
            .collect()
    }

    pub fn is_created_only_through_subclasses(&self, file: FileId, class: ClassId) -> bool {
        self.hir(file)[class].flags.contains(Flags::ABSTRACT) && !self.has_direct_eval(file)
    }

    pub fn classes_referenced_by_typeof(&mut self) -> FxHashSet<(FileId, ClassId)> {
        let mut found = FxHashSet::default();
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            let hir = self.hir(file);
            for node in hir.types.iter() {
                let TypeNodeKind::Typeof { expr, .. } = node.kind else { continue };
                if expr.is_none() {
                    continue;
                }
                let ExprKind::Ident(name) = hir[expr].kind else { continue };
                let Some(sym) = self.resolved_symbol_for(file, expr, name) else { continue };
                if let Some((of, Decl::Class(class))) = self.variable_declaration(sym) {
                    found.insert((of, class));
                }
            }
        }
        found
    }

    pub fn mutated_globals_in(&mut self, file: FileId, out: &mut Vec<Atom>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut seen = FxHashSet::default();
        for (class, c) in hir.classes.iter().enumerate() {
            if c.extends.is_none() || c.flags.contains(Flags::AMBIENT) || bound.class_symbol[class].is_none() {
                continue;
            }
            let extended = self.type_of_expr(file, c.extends);
            if let ExprKind::Ident(name) = hir[c.extends].kind
                && self.symbol_of_identifier(file, c.extends, name).is_none()
            {
                out.extend([name, self.atoms().intern(b"Error")]);
                if self.atoms().bytes(name) == b"Buffer" {
                    out.push(self.atoms().intern(b"Uint8Array"));
                }
            }
            let signatures = self.signatures(extended, true).into_vec();
            if signatures.is_empty() {
                let errors: [&[u8]; 8] = [b"Error", b"AggregateError", b"EvalError", b"RangeError", b"ReferenceError", b"SyntaxError", b"TypeError", b"URIError"];
                out.extend(errors.map(|name| self.atoms().intern(name)));
                if let ExprKind::Ident(name) | ExprKind::Dot { name, .. } = hir[c.extends].kind
                    && self.global_type_symbol(name).is_some()
                {
                    out.push(name);
                }
            }
            for signature in signatures {
                let created = self.sig_return(signature);
                self.add_global_classes(created, &mut seen, out);
            }
        }
    }

    fn add_global_classes(&mut self, ty: TypeId, seen: &mut FxHashSet<Sym>, out: &mut Vec<Atom>) {
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                if !seen.insert(target) {
                    return;
                }
                let name = self.files.symbol(target).name;
                if self.global_type_symbol(name) == Some(target) {
                    out.push(name);
                }
                for base in self.base_types(target).into_vec() {
                    self.add_global_classes(base, seen, out);
                }
            }
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                for &part in parts.iter() {
                    self.add_global_classes(part, seen, out);
                }
            }
            _ => {}
        }
    }

    fn is_only_declared(&self, sym: Sym) -> bool {
        match self.files.value_declaration(sym) {
            Some((file, decl)) => !self.is_compiled(file) || self.bound(file).modifier_flags(self.hir(file), decl).contains(Flags::AMBIENT),
            None => true,
        }
    }

    pub fn prototype_property_names_in(&mut self, file: FileId, out: &mut Vec<Atom>) {
        self.prototype_property_names_by_function_in(file, out, &mut [0; 3]);
    }

    pub(super) fn explain_prototype_property_names(&mut self) -> ([usize; 3], usize) {
        let (mut names, mut places) = (Vec::new(), [0; 3]);
        for file in self.files_declaring_classes() {
            self.prototype_property_names_by_function_in(file, &mut names, &mut places);
        }
        (places, self.prototype_property_names().len())
    }

    fn prototype_property_names_by_function_in(&mut self, file: FileId, out: &mut Vec<Atom>, places: &mut [usize; 3]) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack {
            return;
        }
        let mut is_prototype = |c: &Checker<'p, 's>, e: ExprId| {
            let of = match hir[skip_assertions(hir, e)].kind {
                ExprKind::Dot { obj, name, .. } if name == known::prototype => obj,
                ExprKind::Index { obj, index, .. } if matches!(hir[index].kind, ExprKind::String(name) if name == known::prototype) => obj,
                _ => return false,
            };
            let named = c.resolve_function_expr(file, of, 0);
            places[match named {
                NamedFunction::Other => 0,
                NamedFunction::Constructor(..) => 1,
                NamedFunction::Unknown => 2,
            }] += 1;
            !matches!(named, NamedFunction::Other)
        };
        for (index, node) in hir.exprs.iter().enumerate() {
            if bound.expr_parent[index] == Parent::None {
                continue;
            }
            let e = ExprId(index as u32);
            match node.kind {
                ExprKind::Dot { obj, name, .. } if self.access_store_kind(file, e) == Some(false) && is_prototype(self, obj) => out.push(name),
                ExprKind::Index { obj, index: key, .. } if self.access_store_kind(file, e) == Some(false) && is_prototype(self, obj) => {
                    if let ExprKind::String(name) = hir[key].kind {
                        out.push(name);
                    }
                    out.extend(self.property_named_by_constant_symbol(file, key));
                }
                ExprKind::Call(call) => {
                    let ExprKind::Dot { obj: global, name: function, .. } = hir[hir[call].callee].kind else { continue };
                    let ExprKind::Ident(global_name) = hir[global].kind else { continue };
                    let accepts_key = match (self.atoms().bytes(global_name), self.atoms().bytes(function)) {
                        (b"Object" | b"Reflect", b"defineProperty") | (b"Reflect", b"set") => true,
                        (b"Object", b"defineProperties" | b"assign") => false,
                        _ => continue,
                    };
                    let mut args = hir.ids(hir[call].args);
                    if !args.next().is_some_and(|target| is_prototype(self, target)) || !self.symbol_of_identifier(file, global, global_name).is_none_or(|sym| self.is_only_declared(sym)) {
                        continue;
                    }
                    if accepts_key {
                        if let Some(key) = args.next() {
                            if let ExprKind::String(name) = hir[key].kind {
                                out.push(name);
                            }
                            out.extend(self.property_named_by_constant_symbol(file, key));
                        }
                        continue;
                    }
                    for source in args {
                        if let ExprKind::Object(props) = hir[skip_assertions(hir, source)].kind {
                            out.extend(props.iter().filter_map(|p| match hir[p].key {
                                PropKey::Name(_) | PropKey::Computed(_) if hir[p].kind != PropKind::Spread => self.known_member_name(file, hir[p].key),
                                _ => None,
                            }));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    pub(super) fn prototype_property_names(&mut self) -> &'p FxHashSet<FieldKey> {
        let program = self.p;
        program.aot.classes.prototype_property_names.get_or_init(|| {
            let mut names = Vec::new();
            for file in self.files_declaring_classes() {
                self.prototype_property_names_in(file, &mut names);
            }
            names.into_iter().map(|name| self.field_key_of_property(name)).collect()
        })
    }

    pub fn has_mutable_prototype(&self, file: FileId, func: FnId) -> bool {
        let known = self.mutable_prototypes();
        known.functions.contains(&(file, func)) || known.every && self.is_constructor_function(file, func) && self.may_be_used_as_value(file, func)
    }

    pub fn functions_with_mutable_prototype(&self) -> Vec<(FileId, FnId)> {
        let known = self.mutable_prototypes();
        let constructor_functions = self.discriminants().constructor_functions.iter().map(|it| it.function);
        known.functions.iter().copied().chain(constructor_functions.filter(|&(file, func)| known.every && self.may_be_used_as_value(file, func))).collect()
    }

    pub fn has_no_field_names_on_prototype(&self, file: FileId, func: FnId) -> bool {
        self.is_constructor_function(file, func) && !self.may_be_used_as_value(file, func)
    }

    fn is_constructor_function(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        hir[func].this_ty(hir).is_some() && self.discriminants().constructor_functions.iter().any(|it| it.function == (file, func))
    }

    fn may_be_used_as_value(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if hir.is_js
            || bound.ran_out_of_stack
            || f.kind != FnKind::Decl
            || f.flags.intersects(Flags::EXPORT | Flags::DEFAULT | Flags::AMBIENT)
            || self.has_direct_eval(file)
            || self.mentions_arguments_object(file, func)
        {
            return true;
        }
        let id = bound.fn_symbol[func.idx()];
        let Some(symbol) = bound.symbols.get(id.idx()) else { return true };
        let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
        if symbol.flags.intersects(is_more) || symbol.decls.len() != 1 {
            return true;
        }
        if hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == f.name)) {
            return true;
        }
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return true };
        if matches!(bound.stmt_parent[stmt.idx()], Parent::File) && !hir.has_module_syntax {
            return true;
        }
        let is_within = |e: ExprId| {
            let mut around = self.enclosing_fn_of_expr(file, e);
            while let Some(arrow) = around.filter(|&it| hir[it].kind == FnKind::Arrow) {
                around = bound.fns[arrow.idx()].enclosing.some();
            }
            around == Some(func)
        };
        if self.file_exprs_by_kind(file).of(ExprTag::NewTarget).iter().any(|&e| is_within(e)) {
            return true;
        }
        self.file_exprs_by_kind(file).of(ExprTag::Ident).iter().filter(|&&mention| bound.expr_symbol[mention.idx()] == id).any(|&mention| {
            let mut asserted = mention;
            while let Parent::Expr(parent) = bound.expr_parent[asserted.idx()]
                && parent.is_some()
                && matches!(hir[parent].kind, ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) if expr == asserted)
            {
                asserted = parent;
            }
            !matches!(bound.expr_parent[asserted.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::New(call) if hir[call].callee == asserted))
        })
    }

    pub(super) fn explain_mutable_prototypes(&self) -> (bool, Option<super::flows::Place>, usize, usize) {
        let all = &self.discriminants().constructor_functions;
        let known = self.mutable_prototypes();
        (known.every, known.all_since, all.iter().filter(|it| self.has_mutable_prototype(it.function.0, it.function.1)).count(), all.len())
    }

    fn mutable_prototypes(&self) -> &'p MutablePrototypes {
        self.p.aot.classes.mutable_prototypes.get_or_init(|| {
            let mut found = MutablePrototypes::default();
            if self.discriminants().constructor_functions.is_empty() {
                return found;
            }
            for file in self.files_declaring_classes() {
                found.every |= self.bound(file).ran_out_of_stack;
                if found.every {
                    break;
                }
                self.add_mutable_prototypes_in(file, &mut found);
            }
            found
        })
    }

    fn add_mutable_prototypes_in(&self, file: FileId, found: &mut MutablePrototypes) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let names_prototype = |key: ExprId| matches!(hir[key].kind, ExprKind::String(name) if name == known::prototype);
        let mut sites: Vec<(ExprId, bool)> = Vec::new();
        for (index, node) in hir.exprs.iter().enumerate() {
            if bound.expr_parent[index] == Parent::None {
                continue;
            }
            let e = ExprId(index as u32);
            match node.kind {
                ExprKind::Dot { obj, name, .. } if name == known::prototype => match self.prototype_use(file, e) {
                    PrototypeUse::Accessed => {}
                    how => sites.push((obj, how == PrototypeUse::Replaced)),
                },
                ExprKind::Index { obj, index: key, .. } if names_prototype(key) => match self.prototype_use(file, e) {
                    PrototypeUse::Accessed => {}
                    how => sites.push((obj, how == PrototypeUse::Replaced)),
                },
                ExprKind::Call(call) => {
                    let mut args = hir.ids(hir[call].args);
                    let Some(first) = args.next() else { continue };
                    let is_replaced = match self.global_method_names(file, call) {
                        Some((b"Object" | b"Reflect", b"defineProperty")) | Some((b"Reflect", b"set")) => args.next().is_some_and(|key| names_prototype(key)),
                        Some((b"Object", b"defineProperties" | b"assign")) => args.any(|source| {
                            matches!(hir[skip_assertions(hir, source)].kind, ExprKind::Object(props) if props.iter().any(|p| matches!(hir[p].key, PropKey::Name(name) if name == known::prototype)))
                        }),
                        Some((b"Reflect", b"construct")) => args.nth(1).is_some(),
                        Some(_) => false,
                        None => matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) | ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"inherits"),
                    };
                    if is_replaced {
                        sites.push((first, true));
                    }
                }
                _ => {}
            }
        }
        for (function, is_replaced) in sites {
            match self.resolve_function_expr(file, function, 0) {
                NamedFunction::Constructor(of, func) => {
                    found.functions.insert((of, func));
                }
                NamedFunction::Unknown if is_replaced => {
                    found.every = true;
                    found.all_since.get_or_insert(super::flows::Place { file, pos: hir[function].pos });
                }
                NamedFunction::Unknown | NamedFunction::Other => {}
            }
        }
    }

    fn prototype_use(&self, file: FileId, prototype: ExprId) -> PrototypeUse {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.access_store_kind(file, prototype).is_some() {
            return PrototypeUse::Replaced;
        }
        let mut asserted = prototype;
        while let Parent::Expr(parent) = bound.expr_parent[asserted.idx()]
            && parent.is_some()
            && matches!(hir[parent].kind, ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) if expr == asserted)
        {
            asserted = parent;
        }
        let Parent::Expr(parent) = bound.expr_parent[asserted.idx()] else { return PrototypeUse::Escapes };
        let Some(parent) = parent.some() else { return PrototypeUse::Escapes };
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == asserted => {
                if self.atoms().bytes(name) == b"__proto__" && self.access_store_kind(file, parent).is_some() { PrototypeUse::Replaced } else { PrototypeUse::Accessed }
            }
            ExprKind::Index { obj, .. } if obj == asserted => PrototypeUse::Accessed,
            ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq, .. } | ExprKind::Unary { op: UnOp::Typeof | UnOp::Not | UnOp::Void, .. } => PrototypeUse::Accessed,
            ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(asserted) => match self.global_method_names(file, call) {
                Some((_, b"setPrototypeOf")) => PrototypeUse::Replaced,
                Some((b"Object", b"defineProperty" | b"defineProperties" | b"assign")) | Some((b"Reflect", b"defineProperty" | b"set")) => PrototypeUse::Accessed,
                _ => PrototypeUse::Escapes,
            },
            _ => PrototypeUse::Escapes,
        }
    }

    fn global_method_names(&self, file: FileId, call: CallId) -> Option<(&'p [u8], &'p [u8])> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj: global, name: method, .. } = hir[hir[call].callee].kind else { return None };
        let ExprKind::Ident(global_name) = hir[global].kind else { return None };
        let names = (self.atoms().bytes(global_name), self.atoms().bytes(method));
        (matches!(names.0, b"Object" | b"Reflect") && self.resolve_identifier(file, global, global_name, true).ok().flatten().is_none_or(|sym| self.is_only_declared(sym))).then_some(names)
    }

    fn resolve_function_expr(&self, file: FileId, e: ExprId, depth: u32) -> NamedFunction {
        let hir = self.hir(file);
        let e = skip_assertions(hir, e);
        let constructor = |of: FileId, func: FnId| self.is_constructor_function(of, func).then_some(NamedFunction::Constructor(of, func));
        match hir[e].kind {
            ExprKind::Fn(func) => constructor(file, func).unwrap_or(NamedFunction::Other),
            ExprKind::Class(_) | ExprKind::Object(_) | ExprKind::Array(_) => NamedFunction::Other,
            ExprKind::Ident(name) => {
                let Some(mut sym) = self.resolve_identifier(file, e, name, true).ok().flatten() else { return NamedFunction::Unknown };
                if self.files.flags(sym).contains(SymFlags::ALIAS) {
                    let Some(target) = self.files.resolve_alias(sym) else { return NamedFunction::Unknown };
                    sym = target;
                }
                if self.is_only_declared(sym) {
                    return NamedFunction::Other;
                }
                let declared = self.files.decls_of(sym).iter().copied().find_map(|(of, decl)| if let Decl::Fn(func) = decl { constructor(of, func) } else { None });
                if let Some(declared) = declared {
                    return declared;
                }
                match self.files.value_declaration(sym) {
                    Some((of, Decl::Var(pat))) => match self.bound(of).pat_parent[pat.idx()] {
                        PatParent::Var(d) if self.hir(of)[d].kind == VarKind::Const && self.hir(of)[d].init.is_some() && depth < 8 => self.resolve_function_expr(of, self.hir(of)[d].init, depth + 1),
                        _ => NamedFunction::Unknown,
                    },
                    Some((_, Decl::Param(_) | Decl::Require(_))) | None => NamedFunction::Unknown,
                    Some(_) => NamedFunction::Other,
                }
            }
            _ => NamedFunction::Unknown,
        }
    }

    pub(super) fn files_declaring_classes(&self) -> Vec<FileId> {
        let is_code = |&file: &FileId| !matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) && !self.files.module(file).is_opaque();
        (0..self.files.modules.len() as u32).map(FileId).filter(is_code).collect()
    }

    fn method_declarations_by_name(&self) -> &'p MethodDeclarations {
        self.p.aot.classes.method_declarations.get_or_init(|| {
            let mut declaring = MethodDeclarations::default();
            for file in self.files_declaring_classes() {
                let hir = self.hir(file);
                for (class, c) in hir.classes.iter().enumerate() {
                    if c.flags.contains(Flags::AMBIENT) {
                        continue;
                    }
                    for member in c.members.iter() {
                        let m = &hir[member];
                        let PropKey::Name(name) = m.key else { continue };
                        if !matches!(m.kind, MemberKind::Method | MemberKind::Getter | MemberKind::Setter) || m.func.is_none() || matches!(hir[m.func].body, FnBody::None) {
                            continue;
                        }
                        let entry = MethodDeclaration { class: (file, ClassId(class as u32)), is_static: m.flags.contains(Flags::STATIC), is_accessor: m.kind != MemberKind::Method };
                        let classes = declaring.entry(name).or_default();
                        if !classes.iter().rev().take_while(|declared| declared.class == entry.class).any(|declared| *declared == entry) {
                            classes.push(entry);
                        }
                    }
                }
            }
            declaring
        })
    }

    fn computed_methods(&self) -> &'p [((FileId, ClassId), ExprId)] {
        self.p.aot.classes.computed_methods.get_or_init(|| {
            let mut computed = Vec::new();
            for file in self.files_declaring_classes() {
                let hir = self.hir(file);
                for (class, c) in hir.classes.iter().enumerate() {
                    if c.flags.contains(Flags::AMBIENT) {
                        continue;
                    }
                    for m in c.members.iter().map(|member| &hir[member]) {
                        if let PropKey::Computed(key) = m.key
                            && matches!(m.kind, MemberKind::Method | MemberKind::Getter | MemberKind::Setter)
                            && !m.flags.contains(Flags::STATIC)
                            && m.func.is_some()
                            && !matches!(hir[m.func].body, FnBody::None)
                        {
                            computed.push(((file, ClassId(class as u32)), key));
                        }
                    }
                }
            }
            computed
        })
    }

    pub fn method_stores_in(&mut self, file: FileId) -> Vec<MethodStore> {
        let mut found: Vec<(TypeId, Atom, bool)> = Vec::new();
        self.add_method_stores_in(file, &mut found);
        let mut seen = FxHashSet::default();
        found.retain(|&store| seen.insert(store));
        found.into_iter().map(|(object, name, defines)| MethodStore { object, name: self.atoms().bytes(name).into(), defines }).collect()
    }

    fn add_method_stores_in(&mut self, file: FileId, out: &mut Vec<(TypeId, Atom, bool)>) {
        let declaring = self.method_declarations_by_name();
        let index = self.file_exprs_by_kind(file);
        let hir = self.hir(file);
        let matters = |name: Atom, defines: bool| name == known::constructor || declaring.get(&name).is_some_and(|declared| defines || declared.iter().any(|declaration| !declaration.is_accessor));
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot { obj, name, .. } = hir[e].kind else { continue };
            if (declaring.contains_key(&name) || name == known::constructor)
                && let Some(defines) = self.access_store_kind(file, e)
                && matters(name, defines)
                && !self.is_self_bind_assignment(file, e)
                && !self.is_assignment_to_method_field(file, e)
            {
                self.add_method_store(file, obj, name, defines, out);
            }
        }
        for &e in index.of(ExprTag::Index) {
            let ExprKind::Index { obj, index: key, .. } = hir[e].kind else { continue };
            if matches!(hir[key].kind, ExprKind::Number(_)) || self.is_self_bind_assignment(file, e) {
                continue;
            }
            let Some(defines) = self.access_store_kind(file, e) else { continue };
            for name in self.key_literal_names(file, key) {
                if matters(name, defines) {
                    self.add_method_store(file, obj, name, defines, out);
                }
            }
        }
        for &e in index.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[e].kind else { continue };
            let spies = match hir[hir[call].callee].kind {
                ExprKind::Ident(function) => self.atoms().bytes(function) == b"spyOn",
                ExprKind::Dot { obj, name: function, .. } => self.atoms().bytes(function) == b"spyOn" && matches!(hir[obj].kind, ExprKind::Ident(runner) if matches!(self.atoms().bytes(runner), b"jest" | b"vi")),
                _ => false,
            };
            if spies {
                let mut args = hir.ids(hir[call].args);
                if let (Some(target), Some(key)) = (args.next(), args.next()) {
                    for name in self.key_literal_names(file, key) {
                        if matters(name, false) {
                            self.add_method_store(file, target, name, false, out);
                        }
                    }
                }
                continue;
            }
            let ExprKind::Dot { obj: global, name: function, .. } = hir[hir[call].callee].kind else { continue };
            let ExprKind::Ident(global_name) = hir[global].kind else { continue };
            let (names_by_key, defines) = match (self.atoms().bytes(global_name), self.atoms().bytes(function)) {
                (b"Object" | b"Reflect", b"defineProperty") | (b"Reflect", b"deleteProperty") => (true, true),
                (b"Reflect", b"set") => (true, false),
                (b"Object", b"defineProperties") => (false, true),
                (b"Object", b"assign") => (false, false),
                _ => continue,
            };
            if !self.symbol_of_identifier(file, global, global_name).is_none_or(|sym| self.is_only_declared(sym)) {
                continue;
            }
            let args: Vec<ExprId> = hir.ids(hir[call].args).collect();
            let Some((&target, rest)) = args.split_first() else { continue };
            let mut names: Vec<Atom> = Vec::new();
            if names_by_key {
                names.extend(rest.first().into_iter().flat_map(|&key| self.key_literal_names(file, key)));
            } else {
                for &literal in rest {
                    let ExprKind::Object(props) = hir[literal].kind else { continue };
                    names.extend(props.iter().filter_map(|p| hir[p].key.name()));
                }
            }
            for name in names {
                if matters(name, defines) {
                    self.add_method_store(file, target, name, defines, out);
                }
            }
        }
    }

    fn method_assignment_in_class(&self, file: FileId, e: ExprId) -> Option<(ClassId, Atom)> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, .. } = hir[e].kind else { return None };
        let bytes = self.atoms().bytes(name);
        if !matches!(hir[obj].kind, ExprKind::This) || self.access_store_kind(file, e) != Some(false) || bytes == b"__proto__" || bytes == b"constructor" || !bytes.first().is_some_and(|first| !first.is_ascii_digit()) {
            return None;
        }
        let declarations = self.method_declarations_by_name().get(&name)?;
        if declarations.iter().any(|declaration| declaration.is_accessor) {
            return None;
        }
        let Some(Ok(function)) = self.this_container(file, obj) else { return None };
        let FnOwner::Member(member) = self.bound(file).fns[function.idx()].owner else { return None };
        let MemberOwner::Class(class) = self.bound(file).member_owner[member.idx()] else { return None };
        (!hir[member].flags.contains(Flags::STATIC)).then_some((class, name))
    }

    fn method_assignments_by_name(&self) -> &'p FxHashMap<Atom, Vec<(FileId, ClassId)>> {
        self.p.aot.classes.method_assignments_by_name.get_or_init(|| {
            let mut found: FxHashMap<Atom, Vec<(FileId, ClassId)>> = FxHashMap::default();
            for file in self.files_declaring_classes().into_iter().filter(|&file| self.is_compiled(file) && !self.is_untyped_file(file)) {
                for &e in self.file_exprs_by_kind(file).of(ExprTag::Dot) {
                    if let Some((class, name)) = self.method_assignment_in_class(file, e) {
                        let classes = found.entry(name).or_default();
                        if !classes.contains(&(file, class)) {
                            classes.push((file, class));
                        }
                    }
                }
            }
            found
        })
    }

    fn class_declares_method(&self, class: (FileId, ClassId), name: Atom) -> bool {
        self.method_declarations_by_name().get(&name).is_some_and(|declarations| declarations.iter().any(|declaration| declaration.class == class && !declaration.is_static))
    }

    fn is_assignment_to_method_field(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        let Some((class, name)) = self.method_assignment_in_class(file, e) else { return false };
        let mut at = (file, class);
        for _ in 0..256 {
            if self.class_declares_method(at, name) {
                return true;
            }
            match self.resolve_superclass(at.0, at.1) {
                Superclass::Known(extended) => at = extended,
                _ => return false,
            }
        }
        false
    }

    pub fn methods_with_fields(&mut self, file: FileId, class: ClassId) -> Vec<Atom> {
        let assignments = self.method_assignments_by_name();
        let mut found: Vec<Atom> = assignments.iter().filter(|(_, classes)| classes.contains(&(file, class))).map(|(&name, _)| name).collect();
        found.retain(|&name| {
            let mut at = (file, class);
            for _ in 0..256 {
                if self.class_declares_method(at, name) {
                    return true;
                }
                match self.resolve_superclass(at.0, at.1) {
                    Superclass::Known(extended) => at = extended,
                    _ => return false,
                }
            }
            false
        });
        found.sort_unstable_by(|&a, &b| self.atoms().bytes(a).cmp(self.atoms().bytes(b)));
        found
    }

    pub fn is_read_receiver(&self, file: FileId, e: ExprId) -> bool {
        matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(self.hir(file)[parent].kind, ExprKind::Dot { obj, .. } if obj == e) && self.access_store_kind(file, parent).is_none())
    }

    pub(super) fn property_container_mutations(&self) -> &'p FxHashMap<Atom, Vec<(FileId, ExprId, ExprId)>> {
        self.p.aot.classes.property_container_mutations.get_or_init(|| {
            let mut found: FxHashMap<Atom, Vec<(FileId, ExprId, ExprId)>> = FxHashMap::default();
            for file in (0..self.files.modules.len() as u32).map(FileId) {
                if !self.is_compiled(file) || self.is_untyped_file(file) || self.bound(file).ran_out_of_stack {
                    continue;
                }
                let (hir, index) = (self.hir(file), self.file_exprs_by_kind(file));
                for &e in index.of(ExprTag::Call) {
                    let ExprKind::Call(call) = hir[e].kind else { continue };
                    let ExprKind::Dot { obj: container, name: method, .. } = hir[hir[call].callee].kind else { continue };
                    let ExprKind::Dot { obj: holder, name, .. } = hir[container].kind else { continue };
                    if matches!(self.atoms().bytes(method), b"push" | b"unshift" | b"splice" | b"fill" | b"set" | b"add") {
                        found.entry(name).or_default().extend(hir.ids(hir[call].args).map(|argument| (file, holder, argument)));
                    }
                }
                for &e in index.of(ExprTag::Assign) {
                    let ExprKind::Assign { target, value, .. } = hir[e].kind else { continue };
                    let ExprKind::Index { obj: container, .. } = hir[target].kind else { continue };
                    let ExprKind::Dot { obj: holder, name, .. } = hir[container].kind else { continue };
                    found.entry(name).or_default().push((file, holder, value));
                }
            }
            found
        })
    }

    pub(super) fn property_assignments(&self) -> &'p FxHashMap<Atom, Vec<(FileId, ExprId)>> {
        self.p.aot.classes.property_assignments.get_or_init(|| {
            let mut found: FxHashMap<Atom, Vec<(FileId, ExprId)>> = FxHashMap::default();
            for file in (0..self.files.modules.len() as u32).map(FileId) {
                if !self.is_compiled(file) || self.is_untyped_file(file) || self.bound(file).ran_out_of_stack {
                    continue;
                }
                let hir = self.hir(file);
                for &assignment in self.file_exprs_by_kind(file).of(ExprTag::Assign) {
                    let ExprKind::Assign { target, .. } = hir[assignment].kind else { continue };
                    if let ExprKind::Dot { name, .. } = hir[target].kind {
                        found.entry(name).or_default().push((file, assignment));
                    }
                }
            }
            found
        })
    }

    pub(super) fn union_key_assignments(&mut self) -> &'p [(FileId, ExprId)] {
        let program = self.p;
        let shared = &program.aot.classes.union_key_assignments;
        if let Some(known) = shared.get() {
            return known;
        }
        let _search = program.aot.classes.union_key_assignments_search.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(known) = shared.get() {
            return known;
        }
        let mut found = Vec::new();
        for &(file, assignment) in self.computed_key_assignments() {
            let hir = self.hir(file);
            let ExprKind::Assign { target, .. } = hir[assignment].kind else { continue };
            let ExprKind::Index { obj, index, .. } = hir[target].kind else { continue };
            if let ExprKind::Ident(name) = hir[index].kind
                && let Some(binding) = self.identifier_binding(file, index, name)
                && self.type_of_symbol(binding) == TypeId::NUMBER
            {
                continue;
            }
            let key = self.type_of_expr(file, index);
            let parts = self.parts(key);
            if parts.len() < 2 || !parts.iter().all(|&part| matches!(self.data(part), TypeData::StringLit { .. })) {
                continue;
            }
            let receiver = self.type_of_expr(file, obj);
            let receiver = self.non_nullable(receiver);
            let stored = self.type_of_expr(file, assignment);
            if self.is_uninformative(receiver) || self.is_uninformative(stored) {
                continue;
            }
            let names: Vec<Atom> = self.parts(key).iter().filter_map(|&part| match *self.data(part) {
                TypeData::StringLit { value, .. } => Some(value),
                _ => None,
            }).collect();
            if names.into_iter().any(|name| self.type_of_property(receiver, name).is_some_and(|held| !self.is_provably_assignable(stored, held))) {
                found.push((file, assignment));
            }
        }
        shared.get_or_init(|| found)
    }

    pub(super) fn computed_key_assignments(&self) -> &'p [(FileId, ExprId)] {
        self.p.aot.classes.computed_key_assignments.get_or_init(|| {
            let mut found = Vec::new();
            for file in (0..self.files.modules.len() as u32).map(FileId) {
                if !self.is_compiled(file) || self.is_untyped_file(file) || self.bound(file).ran_out_of_stack {
                    continue;
                }
                let hir = self.hir(file);
                for &assignment in self.file_exprs_by_kind(file).of(ExprTag::Assign) {
                    let ExprKind::Assign { target, .. } = hir[assignment].kind else { continue };
                    if let ExprKind::Index { index, .. } = hir[target].kind
                        && !matches!(hir[index].kind, ExprKind::String(_) | ExprKind::Number(_))
                    {
                        found.push((file, assignment));
                    }
                }
            }
            found
        })
    }

    pub(super) fn stores_in_checked_sources(&self) -> Option<&'p FxHashMap<Atom, Vec<(FileId, ExprId)>>> {
        let all = || (0..self.files.modules.len() as u32).map(FileId);
        let known = &self.p.aot.classes.stores_in_checked_sources;
        if known.get().is_none() && !all().any(|file| self.is_compiled(file)) {
            return None;
        }
        Some(known.get_or_init(|| {
            let placeholder: FxHashMap<&[u8], FileId> = (all().filter(|&file| self.is_declaration_only(file) && self.hir(file).kind != FileKind::Declaration && self.hir(file).decorators.is_empty()))
                .map(|file| (self.files.module(file).file_name(), file))
                .collect();
            let made_of = all().filter(|&file| self.is_compiled(file) && self.is_untyped_file(file));
            let mut texts: Vec<FileId> = made_of.filter_map(|file| placeholder.get(self.files.module(file).file_name().strip_suffix(b".js")?).copied()).collect();
            texts.sort_unstable_by_key(|file| file.0);
            texts.dedup();
            let mut found: FxHashMap<Atom, Vec<(FileId, ExprId)>> = FxHashMap::default();
            for file in texts {
                let hir = self.hir(file);
                if self.bound(file).ran_out_of_stack {
                    continue;
                }
                for (e, node) in hir.exprs.iter().enumerate() {
                    let name = match node.kind {
                        ExprKind::Dot { name, .. } => name,
                        ExprKind::Index { index, .. } => match hir[index].kind {
                            ExprKind::String(name) => name,
                            _ => continue,
                        },
                        _ => continue,
                    };
                    let e = ExprId(e as u32);
                    if self.access_store_kind(file, e) == Some(false) {
                        found.entry(name).or_default().push((file, e));
                    }
                }
            }
            found
        }))
    }

    fn access_store_kind(&self, file: FileId, mut e: ExprId) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while let Parent::Expr(parent) = bound.expr_parent[e.idx()]
            && parent.is_some()
            && matches!(hir[parent].kind, ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) if expr == e)
        {
            e = parent;
        }
        let is_deleted = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
        (is_deleted || bound.get_assignment_target(hir, e).is_some()).then_some(is_deleted)
    }

    fn add_method_store(&mut self, file: FileId, object: ExprId, name: Atom, defines: bool, out: &mut Vec<(TypeId, Atom, bool)>) {
        let own = self.type_of_expr(file, object);
        out.push((own, name, defines));
        let yielded = self.result_type_of(file, object);
        if yielded != own {
            out.push((yielded, name, defines));
        }
        let mut below = (file, object);
        for _ in 0..8 {
            let inner = match self.hir(below.0)[below.1].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => Some((below.0, expr)),
                ExprKind::Ident(variable) => self.identifier_binding(below.0, below.1, variable).and_then(|sym| self.initializer_of_const(sym)),
                _ => None,
            };
            let Some(inner) = inner else { break };
            below = inner;
            let written = self.type_of_expr(below.0, below.1);
            if written != own && written != yielded {
                out.push((written, name, defines));
            }
        }
    }

    pub(super) fn key_literal_names(&mut self, file: FileId, key: ExprId) -> Vec<Atom> {
        if let ExprKind::String(name) = self.hir(file)[key].kind {
            return vec![name];
        }
        let mut ty = self.type_of_expr(file, key);
        if self.is_instantiable(ty) {
            ty = self.base_constraint(ty);
        }
        match self.data(ty) {
            TypeData::StringLit { value, .. } => vec![*value],
            TypeData::Union(parts) => parts.iter().filter_map(|&part| if let TypeData::StringLit { value, .. } = self.data(part) { Some(*value) } else { None }).collect(),
            _ => Vec::new(),
        }
    }

    fn is_self_bind_assignment(&self, file: FileId, target: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(assignment) = bound.expr_parent[target.idx()] else { return false };
        let ExprKind::Assign { op: None, target: assigned, value } = hir[assignment].kind else { return false };
        let ExprKind::Call(call) = hir[value].kind else { return false };
        let ExprKind::Dot { obj: method, name: function, .. } = hir[hir[call].callee].kind else { return false };
        let mut args = hir.ids(hir[call].args);
        let (Some(this), None) = (args.next(), args.next()) else { return false };
        let is_same = |a: ExprId, b: ExprId| match (hir[a].kind, hir[b].kind) {
            (ExprKind::This, ExprKind::This) => true,
            (ExprKind::Ident(_), ExprKind::Ident(_)) => bound.expr_symbol[a.idx()].is_some() && bound.expr_symbol[a.idx()] == bound.expr_symbol[b.idx()],
            (ExprKind::String(a), ExprKind::String(b)) => a == b,
            _ => false,
        };
        assigned == target
            && self.atoms().bytes(function) == b"bind"
            && match (hir[target].kind, hir[method].kind) {
                (ExprKind::Dot { obj, name, .. }, ExprKind::Dot { obj: read_from, name: read, .. }) => name == read && is_same(obj, read_from) && is_same(obj, this),
                (ExprKind::Index { obj, index, .. }, ExprKind::Index { obj: read_from, index: read, .. }) => is_same(index, read) && is_same(obj, read_from) && is_same(obj, this),
                _ => false,
            }
    }

    pub(super) fn class_for_type(&self, ty: TypeId, is_static: bool) -> Option<(FileId, ClassId)> {
        let symbol = match *self.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) if !is_static && self.files.flags(target).contains(SymFlags::CLASS) => target,
            TypeData::Anon { origin: Origin::ClassStatic(symbol), .. } if is_static => symbol,
            _ => return None,
        };
        match self.files.value_declaration(symbol)? {
            (file, Decl::Class(class)) if !self.is_only_declared(symbol) => Some((file, class)),
            _ => None,
        }
    }

    pub fn replaced_methods(&mut self, stores: Vec<MethodStore>) -> ReplacedMethods {
        let mut replaced = ReplacedMethods::default();
        if stores.is_empty() {
            return replaced;
        }
        let declaring = self.method_declarations_by_name();
        let mut hierarchy = Hierarchy::default();
        for file in self.files_declaring_classes() {
            for class in 0..self.hir(file).classes.len() as u32 {
                let class = ClassId(class);
                if !self.hir(file)[class].flags.contains(Flags::AMBIENT)
                    && let Superclass::Known(extended) = self.resolve_superclass(file, class)
                {
                    hierarchy.parent.insert((file, class), extended);
                    hierarchy.children.entry(extended).or_default().push((file, class));
                }
            }
        }
        let mut seen = FxHashSet::default();
        let undeclared = Vec::new();
        for MethodStore { object, name: text, defines } in stores {
            let Some(name) = self.atoms().lookup(&text) else { continue };
            let is_constructor = &*text == b"constructor";
            let declared_by = match declaring.get(&name) {
                Some(declared_by) => declared_by,
                None if is_constructor => &undeclared,
                None => continue,
            };
            let mut parts = vec![object];
            while let Some(mut part) = parts.pop() {
                if self.is_instantiable(part) {
                    part = self.base_constraint(part);
                }
                part = self.non_nullable(part);
                if self.is_uninformative(part) || !seen.insert((part, name, defines)) {
                    continue;
                }
                if let TypeData::Union(types) | TypeData::Intersection(types) = self.data(part) {
                    parts.extend(types.iter().copied());
                    continue;
                }
                let mut stored_to: Vec<((FileId, ClassId), bool)> = Vec::new();
                let mut structural_receiver = None;
                if let Some(class) = self.class_for_type(part, false) {
                    stored_to.push((class, false));
                } else if let Some(class) = self.class_for_type(part, true) {
                    stored_to.push((class, true));
                } else {
                    structural_receiver = Some(self.layout_defining_type(part));
                    let mut having: Vec<(FileId, ClassId)> = declared_by.iter().filter(|declaration| !declaration.is_static).map(|declaration| declaration.class).collect();
                    let mut visited: FxHashSet<(FileId, ClassId)> = having.iter().copied().collect();
                    let part = self.permissive_instantiation(part);
                    while let Some(class) = having.pop() {
                        let instances = self.class_instance_type(class.0, class.1);
                        if self.is_assignable(instances, part) {
                            stored_to.push((class, false));
                            continue;
                        }
                        for &child in hierarchy.children.get(&class).map_or(&[][..], |children| &children[..]) {
                            if visited.insert(child) {
                                having.push(child);
                            }
                        }
                    }
                }
                if is_constructor {
                    let mut marked: Vec<(FileId, ClassId)> = stored_to.iter().filter(|stored| !stored.1).map(|stored| stored.0).collect();
                    while let Some(class) = marked.pop() {
                        let members = replaced.by_class.entry(class).or_default();
                        if !members.contains(&(name, false)) {
                            members.push((name, false));
                            replaced.names.entry(text.clone()).or_insert(name);
                            marked.extend(hierarchy.children.get(&class).into_iter().flatten().copied());
                        }
                    }
                }
                for (class, is_static) in stored_to {
                    for declaration in declared_by {
                        let other = declaration.class;
                        if declaration.is_static == is_static && (defines || !declaration.is_accessor) && (other == class || hierarchy.extends(class, other) || hierarchy.extends(other, class)) {
                            let members = replaced.by_class.entry(other).or_default();
                            if !members.contains(&(name, is_static)) {
                                members.push((name, is_static));
                                replaced.names.entry(text.clone()).or_insert(name);
                            }
                            if !is_static {
                                let evidence = replaced.structural_evidence.entry((other, name)).or_insert_with(|| Some(Vec::new()));
                                match (evidence.as_mut(), structural_receiver) {
                                    (Some(found), Some(receiver)) => found.push((class, receiver)),
                                    _ => *evidence = None,
                                }
                            }
                        }
                    }
                }
            }
        }
        replaced
    }

    fn discriminants(&self) -> &'p Discriminants {
        self.p.aot.classes.discriminants.get_or_init(|| {
            let mut files = self.files_declaring_classes();
            files.sort_by_key(|&file| self.files.rank_of_file(file));
            let mut found = Discriminants::default();
            for &file in &files {
                let hir = self.hir(file);
                if self.is_untyped_file(file) {
                    continue;
                }
                for (func, f) in hir.fns.iter().enumerate() {
                    if matches!(f.kind, FnKind::Decl | FnKind::Expr)
                        && f.this_ty(hir).is_some()
                        && let FnBody::Block(body) = f.body
                    {
                        let func = FnId(func as u32);
                        found.constructor_functions.push(ConstructorFunction { function: (file, func), initial_stores: self.initial_this_stores(file, func, body) });
                    }
                }
                let type_parameters: FxHashSet<Atom> = hir.type_params.iter().map(|parameter| parameter.name).collect();
                for member in hir.members.iter() {
                    if member.kind == MemberKind::Property
                        && let PropKey::Name(name) = member.key
                        && member.ty.is_some()
                        && may_be_number_type(hir, member.ty, &type_parameters)
                    {
                        found.candidates.insert(name);
                    }
                }
            }
            if found.candidates.is_empty() {
                return found;
            }
            let mut initial: FxHashSet<(FileId, ExprId)> = FxHashSet::default();
            for of in &found.constructor_functions {
                initial.extend(of.initial_stores.iter().filter(|store| store.parameter.is_some()).map(|store| (of.function.0, store.target)));
            }
            for &file in &files {
                if self.bound(file).ran_out_of_stack {
                    found.mutated = found.candidates.clone();
                    break;
                }
                let hir = self.hir(file);
                for (e, node) in hir.exprs.iter().enumerate() {
                    let name = match node.kind {
                        ExprKind::Dot { name, .. } => name,
                        ExprKind::Index { index, .. } => match hir[index].kind {
                            ExprKind::String(name) => name,
                            _ => continue,
                        },
                        _ => continue,
                    };
                    let e = ExprId(e as u32);
                    if found.candidates.contains(&name) && !initial.contains(&(file, e)) && self.access_store_kind(file, e).is_some() {
                        found.mutated.insert(name);
                    }
                }
            }
            found
        })
    }

    pub(super) fn precompute_class_tables(&self) {
        self.discriminants();
        self.mutable_prototypes();
        self.method_declarations_by_name();
    }

    pub(super) fn constructor_functions(&self) -> Vec<(FileId, FnId)> {
        self.discriminants().constructor_functions.iter().map(|it| it.function).collect()
    }

    pub(super) fn may_construct(&mut self, function: (FileId, FnId), created: TypeId) -> bool {
        let this = self.type_of_this_parameter(function.0, function.1);
        !self.is_uninformative(this) && this != TypeId::OBJECT && !self.accepts_primitives(this) && self.is_assignable(created, this)
    }

    fn initial_this_stores(&self, file: FileId, func: FnId, body: IdList<StmtId>) -> Vec<InitialStore> {
        let hir = self.hir(file);
        let this_references = self.file_exprs_by_kind(file).of(ExprTag::This);
        let mut stores: Vec<InitialStore> = Vec::new();
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { break };
            let ExprKind::Assign { op: None, target, value } = hir[e].kind else { break };
            let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[target].kind else { break };
            let within_value = hir[value].pos..hir[value].end;
            if !matches!(hir[obj].kind, ExprKind::This) || this_references.iter().any(|&this| within_value.contains(&hir[this].pos)) {
                break;
            }
            let mut parameter = self.unmodified_parameter(file, func, value);
            for earlier in stores.iter_mut().filter(|earlier| earlier.name == name) {
                (earlier.parameter, parameter) = (None, None);
            }
            stores.push(InitialStore { name, parameter, target });
        }
        stores
    }

    fn unmodified_parameter(&self, file: FileId, func: FnId, e: ExprId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(_) = hir[e].kind else { return None };
        let symbol = bound.expr_symbol[e.idx()].some()?;
        let position = hir[func].params.iter().position(|p| matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) && bound.pat_symbol[hir[p].pat.idx()] == symbol)?;
        let parameter = &hir[hir[func].params.at(position)];
        let is_unmodified = parameter.default.is_none()
            && !parameter.flags.contains(Flags::REST)
            && bound.assignments_to(symbol).is_empty()
            && !self.is_stored_through_assertions(file, symbol);
        is_unmodified.then_some(position as u32)
    }

    pub fn is_immutable_discriminant(&mut self, created: TypeId, name: Atom) -> bool {
        let known = self.discriminants();
        if !known.candidates.contains(&name) || known.mutated.contains(&name) {
            return false;
        }
        let Some(property) = self.type_of_property(created, name) else { return false };
        let parts = self.parts(property);
        !parts.is_empty() && parts.iter().all(|&part| self.is_number_like(part))
    }

    pub fn new_discriminant(&mut self, file: FileId, e: ExprId, created: TypeId) -> Option<(usize, Atom)> {
        let hir = self.hir(file);
        let ExprKind::New(call) = hir[e].kind else { return None };
        let mut stored_by_every_constructor: Option<Vec<(Atom, u32)>> = None;
        let mut others: Vec<&ConstructorFunction> = Vec::new();
        for handed in &self.discriminants().constructor_functions {
            if !self.may_construct(handed.function, created) {
                others.push(handed);
                continue;
            }
            let stores = |name: Atom, parameter: u32| handed.initial_stores.iter().any(|store| store.name == name && store.parameter == Some(parameter));
            stored_by_every_constructor = Some(match stored_by_every_constructor {
                None => handed.initial_stores.iter().filter_map(|store| Some((store.name, store.parameter?))).collect(),
                Some(so_far) => so_far.into_iter().filter(|&(name, parameter)| stores(name, parameter)).collect(),
            });
        }
        let written = hir.ids(hir[call].args).take_while(|&argument| !matches!(hir[argument].kind, ExprKind::Spread(_))).count();
        stored_by_every_constructor?.into_iter().find_map(|(name, parameter)| {
            let has_external_stores = others.iter().any(|other| other.initial_stores.iter().any(|store| store.name == name));
            ((parameter as usize) < written && !has_external_stores && self.is_immutable_discriminant(created, name)).then_some((parameter as usize, name))
        })
    }

    pub fn object_literal_discriminant(&mut self, file: FileId, e: ExprId, created: TypeId) -> Option<Atom> {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[e].kind else { return None };
        if props.iter().any(|p| hir[p].kind == PropKind::Spread || !matches!(hir[p].key, PropKey::Name(_))) {
            return None;
        }
        let mut write_count: FxHashMap<Atom, u32> = FxHashMap::default();
        if props.len >= 32 {
            for p in props.iter() {
                if let PropKey::Name(name) = hir[p].key {
                    *write_count.entry(name).or_default() += 1;
                }
            }
        }
        props.iter().find_map(|p| {
            let PropKey::Name(name) = hir[p].key else { return None };
            let is_written_once = match write_count.get(&name) {
                Some(&times) => times == 1,
                None => props.iter().filter(|&other| matches!(hir[other].key, PropKey::Name(of_other) if of_other == name)).count() == 1,
            };
            (matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) && is_written_once && self.is_immutable_discriminant(created, name)).then_some(name)
        })
    }

    fn file_class_facts(&mut self, file: FileId) -> &'p FileFacts {
        let program = self.p;
        program.aot.classes.by_file.get_or_init(program.files.modules.len(), file, || self.find_file_class_facts(file))
    }

    fn find_file_class_facts(&mut self, file: FileId) -> FileFacts {
        let index = self.file_exprs_by_kind(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = FileFacts::default();
        let receiver_of = |e: ExprId| {
            let mut func = self.evaluating_function(file, bound.expr_parent[e.idx()]).unwrap_or(FnId::NONE);
            while func.is_some() && hir[func].kind == FnKind::Arrow {
                func = match bound.fns[func.idx()].owner {
                    FnOwner::Expr(created) => self.evaluating_function(file, bound.expr_parent[created.idx()]).unwrap_or(FnId::NONE),
                    _ => FnId::NONE,
                };
            }
            func.some()
        };
        let function_passed_this = |e: ExprId| {
            let mut at = bound.expr_parent[e.idx()];
            loop {
                at = match at {
                    Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                    Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                    Parent::FnBody(func) if hir[func].kind != FnKind::Arrow => return Some(func),
                    Parent::ParamDefault(p) if hir[bound.param_fn[p.idx()]].kind != FnKind::Arrow => return Some(bound.param_fn[p.idx()]),
                    Parent::None | Parent::File | Parent::MemberInit(_) => return None,
                    _ => self.parent_by_evaluation(file, at),
                };
            }
        };
        found.mentioning_this.extend(index.of(ExprTag::This).iter().filter_map(|&e| function_passed_this(e)));
        found.mentioning_new_target.extend(index.of(ExprTag::NewTarget).iter().filter_map(|&e| receiver_of(e)));
        found.mentioning_super.extend(index.of(ExprTag::Super).iter().filter_map(|&e| receiver_of(e)));
        let mut this_references: FxHashMap<FnId, Vec<ExprId>> = FxHashMap::default();
        for &e in index.of(ExprTag::This).iter().chain(index.of(ExprTag::Super)) {
            if let Some(func) = receiver_of(e).filter(|&func| hir[func].kind == FnKind::Constructor) {
                this_references.entry(func).or_default().push(e);
            }
        }
        let super_call_callee = |e: ExprId| match hir[e].kind {
            ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Super) => Some(hir[call].callee),
            _ => None,
        };
        for class in (0..hir.classes.len() as u32).map(ClassId).filter(|&class| hir[class].extends.is_some()) {
            let Some(func) = self.class_constructor(file, class) else { continue };
            let FnBody::Block(body) = hir[func].body else { continue };
            let binding = hir.ids(body).find_map(|stmt| match hir[stmt].kind {
                StmtKind::Expr(e) => Some((super_call_callee(e)?, hir[e].end)),
                _ => None,
            });
            let is_bound_first = binding.is_some_and(|(callee, end)| {
                let is_another_super_call = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if super_call_callee(parent) == Some(e));
                this_references.get(&func).is_none_or(|mentions| mentions.iter().all(|&e| e == callee || hir[e].pos >= end && !is_another_super_call(e)))
                    && bound.ids(bound.fns[func.idx()].returns).all(|stmt: StmtId| hir[stmt].start >= end)
            });
            if !is_bound_first {
                found.with_uninitialized_this.insert(func);
            }
        }
        for (&e, &class) in bound.private_class.iter() {
            if let ExprKind::PrivateIdentifier(name) = hir[e].kind
                && hir[class].members.iter().any(|member| hir[member].key == PropKey::Private(name) && !hir[member].flags.contains(Flags::STATIC))
            {
                found.tested_by_private_name.insert(class);
            }
        }
        found
    }

    pub fn this_may_be_uninitialized(&mut self, file: FileId, func: FnId) -> bool {
        self.file_class_facts(file).with_uninitialized_this.contains(&func)
    }

    pub fn mentions_new_target(&mut self, file: FileId, func: FnId) -> bool {
        self.file_class_facts(file).mentioning_new_target.contains(&func)
    }

    pub(super) fn mentions_super(&mut self, file: FileId, func: FnId) -> bool {
        self.file_class_facts(file).mentioning_super.contains(&func)
    }

    pub(super) fn uses_this(&mut self, file: FileId, func: FnId) -> bool {
        self.hir(file)[func].kind == FnKind::Constructor || self.inspects_this(file, func) || self.file_class_facts(file).mentioning_super.contains(&func)
    }

    pub fn inspects_this(&mut self, file: FileId, func: FnId) -> bool {
        self.bound(file).fns[func.idx()].contains_this || self.file_class_facts(file).mentioning_this.contains(&func)
    }

    pub fn is_bound_once(&self, file: FileId, decl: Decl) -> bool {
        self.activation_binding(file, decl).is_none()
    }

    pub fn is_in_class_heritage_or_computed_key(&self, file: FileId, e: ExprId, class: ClassId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = bound.expr_parent[e.idx()];
        loop {
            at = match at {
                Parent::ClassExtends(around) if around == class => return true,
                Parent::MemberKey(member) if matches!(bound.member_owner[member.idx()], MemberOwner::Class(around) if around == class) => return true,
                Parent::None | Parent::File | Parent::FnBody(_) | Parent::ParamDefault(_) => return false,
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => return false,
                Parent::Expr(outer) if outer.is_some() => bound.expr_parent[outer.idx()],
                Parent::Stmt(outer) if outer.is_some() => bound.stmt_parent[outer.idx()],
                _ => self.parent_of_node(file, at),
            };
        }
    }

    pub fn is_inside_class(&self, file: FileId, e: ExprId, class: ClassId) -> bool {
        self.enclosing_classes(file, e).contains(&class)
    }

    pub(super) fn activation_binding(&self, file: FileId, decl: Decl) -> Option<Option<FnId>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let node = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                let mut pat = pat;
                loop {
                    match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                        PatParent::Param(p) => return Some(Some(bound.param_fn[p.idx()])),
                        PatParent::Var(d) => {
                            let stmt = Parent::Stmt(bound.var_stmt[d.idx()]);
                            if hir[d].kind == VarKind::Var {
                                return self.enclosing_fn(file, stmt).map(Some);
                            }
                            break stmt;
                        }
                        PatParent::None => return None,
                    }
                }
            }
            Decl::Fn(func) => match bound.fns[func.idx()].owner {
                FnOwner::Stmt(s) => Parent::Stmt(s),
                FnOwner::Expr(e) => Parent::Expr(e),
                _ => return None,
            },
            Decl::Class(class) => bound.class_owner[class.idx()].to_parent(),
            _ => return None,
        };
        match self.evaluating_function(file, node) {
            Some(func) => Some(Some(func)),
            None if self.is_evaluated_once(file, node) => None,
            None => Some(None),
        }
    }


}

const MAX_BASE_CLASSES_EXPLAINED: usize = 4;
const MAX_FIELD_NAMES_SHOWN: usize = 5;

impl<'p, 's> Checker<'p, 's> {
    fn class_site(&self, (file, class): (FileId, ClassId)) -> Place {
        let c = &self.hir(file)[class];
        Place { file, pos: if c.name.is_some() { c.name_pos } else { c.start } }
    }

    fn class_display_name(&self, (file, class): (FileId, ClassId)) -> Vec<u8> {
        let c = &self.hir(file)[class];
        if c.name.is_some() { self.atoms().bytes(c.name).to_vec() } else { b"(anonymous)".to_vec() }
    }

    pub fn find_lost_layouts(&mut self, classes: &[((FileId, ClassId), bool)], scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let has_fixed_layout: FxHashMap<(FileId, ClassId), bool> = classes.iter().copied().collect();
        let mut found = Vec::new();
        for &(class, is_fixed) in classes {
            let (at, name) = (self.class_site(class), self.class_display_name(class));
            if self.is_untyped_file(class.0) {
                continue;
            }
            if !is_fixed {
                let related = self.missing_layout_reasons(class, &has_fixed_layout);
                let (rule, code) = if related.iter().any(|reason| reason.code == 100056) { (Rule::UntypedBase, 100027) } else { (Rule::LostLayout, 100023) };
                if scopes.severity(rule, at.file, at.pos) != Severity::Allow {
                    found.push(CompilerDiagnostic { related, ..self.finding_at(at, code, vec![name]) });
                }
                continue;
            }
            if scopes.severity(Rule::LostLayout, at.file, at.pos) == Severity::Allow {
                continue;
            }
            let dropped: Vec<(Atom, FieldConflict)> = self.declared_only_fields(class.0, class.1).into_iter().filter_map(|(name, conflict)| Some((name, conflict?))).collect();
            if dropped.is_empty() {
                continue;
            }
            let mut names = dropped.iter().take(MAX_FIELD_NAMES_SHOWN).map(|field| self.atoms().bytes(field.0)).collect::<Vec<&[u8]>>().join(&b", "[..]);
            if dropped.len() > MAX_FIELD_NAMES_SHOWN {
                names.extend_from_slice(format!(" and {} more", dropped.len() - MAX_FIELD_NAMES_SHOWN).as_bytes());
            }
            let mut related: Vec<CompilerDiagnostic> = Vec::new();
            for &(field, conflict) in &dropped {
                let field_name = || vec![self.atoms().bytes(field).to_vec()];
                let reason = match conflict {
                    FieldConflict::ComputedName(at) => self.finding_at(at, 100060, Vec::new()),
                    FieldConflict::SameName(at) => self.finding_at(at, 100061, field_name()),
                    FieldConflict::Method(declaring) => {
                        let hir = self.hir(declaring.0);
                        let method = hir[declaring.1].members.iter().find(|&member| hir[member].key == PropKey::Name(field) && hir[member].kind != MemberKind::Property);
                        let at = method.map_or_else(|| self.class_site(declaring), |member| Place { file: declaring.0, pos: hir[member].name_pos });
                        self.finding_at(at, 100061, field_name())
                    }
                };
                if !related.iter().any(|known| (known.file, known.start, known.code) == (reason.file, reason.start, reason.code)) {
                    related.push(reason);
                }
            }
            related.truncate(MAX_FIELD_NAMES_SHOWN);
            found.push(CompilerDiagnostic { related, ..self.finding_at(at, 100024, vec![name, names]) });
        }
        found
    }

    fn missing_layout_reasons(&mut self, class: (FileId, ClassId), has_fixed_layout: &FxHashMap<(FileId, ClassId), bool>) -> Vec<CompilerDiagnostic> {
        let mut reasons = Vec::new();
        let mut next = Some(class);
        for _ in 0..MAX_BASE_CLASSES_EXPLAINED {
            let Some((file, class)) = next.take() else { break };
            let (hir, bound) = (self.hir(file), self.bound(file));
            let c = &hir[class];
            let known_before = reasons.len();
            if let Some(repeating) = self.first_repeating_ancestor(file, bound.class_owner[class.idx()].to_parent()) {
                let function_site = |func: FnId| if hir[func].name.is_some() { hir[func].name_pos } else { hir[func].start };
                let (code, pos) = match repeating {
                    Parent::FnBody(func) => (100050, function_site(func)),
                    Parent::ParamDefault(parameter) => (100050, function_site(bound.param_fn[parameter.idx()])),
                    Parent::Stmt(statement) => (100051, hir[statement].start),
                    Parent::MemberInit(member) | Parent::MemberKey(member) => (100052, hir[member].name_pos),
                    _ => (100050, c.start),
                };
                reasons.push(self.finding_at(Place { file, pos }, code, Vec::new()));
            }
            if self.is_class_named_by_computed_key(file, class) {
                reasons.push(self.finding_at(self.class_site((file, class)), 100053, Vec::new()));
            }
            let decorator = hir.decorators.iter().find(|&&(owner, _)| match owner {
                crate::hir::DecoratorOwner::Class(decorated) => decorated == class,
                _ => self.files().decorated_member(file, owner).is_some_and(|member| bound.member_owner[member.idx()] == MemberOwner::Class(class)),
            });
            if let Some(&(_, decorator)) = decorator {
                reasons.push(self.finding_at(Place { file, pos: hir[decorator].pos }, 100054, Vec::new()));
            }
            let mut constructing = vec![(file, class)];
            if c.extends.is_some() {
                let extends = Place { file, pos: hir[c.extends].pos };
                match self.resolve_superclass(file, class) {
                    Superclass::Known(base) if has_fixed_layout.get(&base) == Some(&false) => {
                        reasons.push(self.finding_at(extends, 100055, vec![self.class_display_name(base)]));
                        next = Some(base);
                    }
                    Superclass::Known(base) if has_fixed_layout.contains_key(&base) => {
                        let constructor = self.class_constructor(file, class).filter(|func| self.file_class_facts(file).with_uninitialized_this.contains(func));
                        if let Some(constructor) = constructor {
                            reasons.push(self.finding_at(Place { file, pos: hir[constructor].start }, 100057, Vec::new()));
                        }
                        let mut base = Some(base);
                        while let Some(extended) = base.take().filter(|_| constructing.len() < 256) {
                            constructing.push(extended);
                            if let Superclass::Known(above) = self.resolve_superclass(extended.0, extended.1) {
                                base = Some(above);
                            }
                        }
                    }
                    _ => {
                        let is_outside_typed_code = bound.class_symbol[class.idx()].is_some() && {
                            let bases = self.base_types(self.class_sym(file, class)).into_vec();
                            bases.into_iter().any(|base| self.type_declaration_site(base).is_some_and(|at| self.hir(at.file).kind == FileKind::Declaration || self.is_untyped_file(at.file)))
                        };
                        reasons.push(self.finding_at(extends, if is_outside_typed_code { 100056 } else { 100062 }, Vec::new()));
                    }
                }
            }
            let instances = self.class_instance_type(file, class);
            if let Some((in_file, call)) = self.redefinition_site(instances) {
                reasons.push(self.finding_at(Place { file: in_file, pos: self.hir(in_file)[call].pos }, 100058, Vec::new()));
            }
            if self.file_class_facts(file).tested_by_private_name.contains(&class) && !self.this_never_escapes_construction(&constructing) {
                let test = bound.private_class.iter().filter(|&(_, &tested)| tested == class).map(|(&e, _)| hir[e].pos).min();
                reasons.push(self.finding_at(Place { file, pos: test.unwrap_or(c.start) }, 100059, Vec::new()));
            }
            if reasons.len() == known_before && c.extends.is_some() {
                reasons.push(self.finding_at(Place { file, pos: hir[c.extends].pos }, 100062, Vec::new()));
            }
        }
        reasons
    }
}

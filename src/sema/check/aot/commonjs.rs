use super::OnceLock;
use super::callees::Callee;
use super::flows::Place;
use crate::atom::{Atom, known};
use crate::bind::{
    Decl, Parent, PatParent, SymFlags, is_module_exports, is_module_exports_inside_parentheses,
    required_specifier, string_literal_text,
};
use crate::check::Checker;
use crate::hir::{
    BinOp, Chain, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, FnKind, ImportEqualsId,
    ImportEqualsTarget, PatKind, PropKey, PropKind, ResolutionMode, SpecifierKind, StmtId,
    StmtKind, UnOp, VarDeclId, VarKind,
};
use crate::program::{FileId, Sym};
use crate::util::{FxHashMap, FxHashSet, InParallel};

const FILES_PER_CHECKER: usize = 32;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CommonJsExports {
    Object,
    Value,
    Variables,
    Of(FileId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportsReference {
    pub module: FileId,
    pub is_namespace: bool,
    pub is_boxed: bool,
}

impl ExportsReference {
    fn new(module: FileId) -> ExportsReference {
        ExportsReference {
            module,
            is_namespace: false,
            is_boxed: false,
        }
    }
}

#[derive(Clone, Copy)]
enum Tree {
    Local(usize),
    ObjectStatic(&'static [&'static [u8]]),
    Known(&'static KnownFunction),
    Call(&'static Tree, &'static [Tree]),
    Member(&'static Tree, &'static [u8]),
    Element(&'static Tree, &'static Tree),
    Literal(&'static [(&'static [u8], Tree)]),
    Getter(&'static Tree),
    Text(&'static [u8]),
    True,
    Not(&'static Tree),
    And(&'static Tree, &'static Tree),
    Or(&'static Tree, &'static Tree),
    Differs(&'static Tree, &'static Tree),
    Same(&'static Tree, &'static Tree),
    Undefined,
    Has(&'static [u8], &'static Tree),
    Choice(&'static Tree, &'static Tree, &'static Tree),
    Either(&'static Tree, &'static Tree),
    Store(&'static Tree, &'static Tree),
}

#[derive(Clone, Copy)]
enum Step {
    ForIn(usize, Tree, &'static Step),
    If(Tree, &'static Step),
    Declare(usize, Tree),
    Do(Tree),
}

#[derive(Clone, Copy)]
enum CopyCondition {
    UnlessExported,
    UnlessExportedWithObjectCreate(&'static [Step]),
}

struct KnownFunction {
    copy_condition: CopyCondition,
    params: usize,
    bodies: &'static [&'static [Step]],
}

const KNOWN_FUNCTION_LOCALS: usize = 5;
const DEFINE_PROPERTY: Tree = Tree::ObjectStatic(&[b"defineProperty"]);
const DEFAULTS_TARGET_NAME_TO_SOURCE_NAME: Step = Step::If(
    Tree::Same(&Tree::Local(3), &Tree::Undefined),
    &Step::Do(Tree::Store(&Tree::Local(3), &Tree::Local(2))),
);
const SOURCE_GETTER_DESCRIPTOR: Tree = Tree::Literal(&[
    (b"enumerable", Tree::True),
    (
        b"get",
        Tree::Getter(&Tree::Element(&Tree::Local(1), &Tree::Local(2))),
    ),
]);
const CREATE_BINDING_HELPER: KnownFunction = KnownFunction {
    copy_condition: CopyCondition::UnlessExportedWithObjectCreate(&[
        DEFAULTS_TARGET_NAME_TO_SOURCE_NAME,
        Step::Do(Tree::Store(
            &Tree::Element(&Tree::Local(0), &Tree::Local(3)),
            &Tree::Element(&Tree::Local(1), &Tree::Local(2)),
        )),
    ]),
    params: 4,
    bodies: &[
        &[
            DEFAULTS_TARGET_NAME_TO_SOURCE_NAME,
            Step::Declare(
                4,
                Tree::Call(
                    &Tree::ObjectStatic(&[b"getOwnPropertyDescriptor"]),
                    &[Tree::Local(1), Tree::Local(2)],
                ),
            ),
            Step::If(
                Tree::Or(
                    &Tree::Not(&Tree::Local(4)),
                    &Tree::Choice(
                        &Tree::Has(b"get", &Tree::Local(4)),
                        &Tree::Not(&Tree::Member(&Tree::Local(1), b"__esModule")),
                        &Tree::Or(
                            &Tree::Member(&Tree::Local(4), b"writable"),
                            &Tree::Member(&Tree::Local(4), b"configurable"),
                        ),
                    ),
                ),
                &Step::Do(Tree::Store(&Tree::Local(4), &SOURCE_GETTER_DESCRIPTOR)),
            ),
            Step::Do(Tree::Call(
                &DEFINE_PROPERTY,
                &[Tree::Local(0), Tree::Local(3), Tree::Local(4)],
            )),
        ],
        &[
            DEFAULTS_TARGET_NAME_TO_SOURCE_NAME,
            Step::Do(Tree::Call(
                &DEFINE_PROPERTY,
                &[Tree::Local(0), Tree::Local(3), SOURCE_GETTER_DESCRIPTOR],
            )),
        ],
    ],
};
const EXPORT_STAR_HELPER: KnownFunction = KnownFunction {
    copy_condition: CopyCondition::UnlessExported,
    params: 2,
    bodies: &[&[Step::ForIn(
        2,
        Tree::Local(0),
        &Step::If(
            Tree::And(
                &Tree::Differs(&Tree::Local(2), &Tree::Text(b"default")),
                &Tree::Not(&Tree::Either(
                    &Tree::Call(
                        &Tree::Member(
                            &Tree::ObjectStatic(&[b"prototype", b"hasOwnProperty"]),
                            b"call",
                        ),
                        &[Tree::Local(1), Tree::Local(2)],
                    ),
                    &Tree::Call(
                        &Tree::Member(&Tree::Local(1), b"hasOwnProperty"),
                        &[Tree::Local(2)],
                    ),
                )),
            ),
            &Step::Do(Tree::Call(
                &Tree::Known(&CREATE_BINDING_HELPER),
                &[Tree::Local(1), Tree::Local(0), Tree::Local(2)],
            )),
        ),
    )]],
};

const OBJECT_PROTOTYPE_NAMES: [&[u8]; 12] = [
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
];

struct Graph {
    modules: Vec<FileId>,
    resolved: FxHashMap<(FileId, Atom), FileId>,
    require_resolutions: FxHashMap<(FileId, Atom), FileId>,
    reevaluated: FxHashSet<FileId>,
    folded: FxHashMap<(FileId, StmtId), bool>,
    implicit: Vec<(FileId, FileId)>,
    entry_points: Vec<FileId>,
    preserves_source_paths: bool,
}

impl Graph {
    fn required(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        self.require_resolutions
            .get(&(file, specifier))
            .or_else(|| self.resolved.get(&(file, specifier)))
            .copied()
    }
}

#[derive(Default)]
pub(super) struct State {
    whole_export_functions: FxHashMap<FileId, Option<(FileId, FnId, bool)>>,
    export_variable_names: Option<FxHashMap<FileId, Vec<Atom>>>,
    create_require_candidates: FxHashMap<FileId, Vec<Atom>>,
}

#[derive(Default)]
pub(super) struct Shared {
    graph: OnceLock<Graph>,
    found: OnceLock<Found>,
    files_with_exports_expressions: OnceLock<FxHashSet<FileId>>,
    reached_by_import: OnceLock<FxHashSet<FileId>>,
}

#[derive(Default)]
struct Found {
    exports: FxHashMap<FileId, CommonJsExports>,
    mentions: FxHashMap<(FileId, ExprId), ExportsReference>,
    stores: FxHashMap<(FileId, Atom), Vec<ExprId>>,
    marked: FxHashMap<FileId, ExprId>,
    aliases: FxHashMap<(FileId, Atom), (FileId, Atom)>,
    alias_definitions: FxHashSet<(FileId, ExprId)>,
    stars: FxHashSet<(FileId, ExprId)>,
    value_only_modules: FxHashSet<FileId>,
    value_only_object_modules: FxHashSet<FileId>,
    named_literals: FxHashMap<FileId, (ExprId, ExprId)>,
    prologues: FxHashMap<FileId, u32>,
    whole: FxHashSet<(FileId, ExprId)>,
    values: FxHashMap<FileId, Vec<ExprId>>,
    stored_once: FxHashSet<FileId>,
    requires_of_evaluated_modules: FxHashSet<(FileId, ExprId)>,
    are_children_read: bool,
    obstacles: Vec<(&'static str, u32)>,
    module_object_reasons: Vec<(&'static str, u32)>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Execution {
    Never,
    Always,
    Sometimes,
    Later,
}

struct Store {
    value: ExprId,
    runs: Execution,
}

struct Module {
    obstacle: Option<&'static str>,
    module_object_reason: Option<&'static str>,
    values: Vec<ExprId>,
    unconditional_value_stores: u32,
    is_redirect: bool,
    re_exports: Option<FileId>,
    mentions: Vec<ExprId>,
    stores: FxHashMap<Atom, Vec<Store>>,
    methods: Vec<Atom>,
    marker: ExprId,
    getters: FxHashMap<Atom, (ExprId, ExprId)>,
    literal: ExprId,
    name_of_literal: ExprId,
    reads: FxHashSet<Atom>,
    stars: Vec<ExprId>,
    is_exact_outside_cycles: bool,
}

impl Module {
    fn is_marked(&self) -> bool {
        self.marker.is_some()
    }

    fn has(&self, name: Atom) -> bool {
        self.stores.contains_key(&name) || self.getters.contains_key(&name)
    }

    fn is_settled(&self) -> bool {
        self.stores.values().all(|stores| {
            stores.iter().all(|store| store.runs != Execution::Later)
                && stores.iter().any(|store| store.runs == Execution::Always)
        })
    }
}

enum Use {
    Member(ExprId, Atom),
    Nothing,
    CopyCondition(VarDeclId),
    Assigned(ExprId),
    Exported,
    Marked(ExprId),
    Defined(ExprId, Atom, ExprId),
    Interop(ExprId, Helper),
    Starred(ExprId),
    StarredInto(ExprId),
    Other(&'static str),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Helper {
    Boxes,
    Other,
}

#[derive(Copy, Clone)]
enum Holder {
    Variable(Sym),
    Import(Decl),
}

enum MemberUse {
    Read,
    Store(ExprId),
    OtherStore,
    Call,
    Delete,
}

#[derive(Default)]
struct Uses {
    mentions: Vec<(FileId, ExprId, ExportsReference)>,
    looked_at: Vec<(FileId, &'static str)>,
    methods: Vec<(FileId, Atom)>,
    required_by_functions: FxHashSet<FileId>,
    requires_of_evaluated_modules: FxHashSet<(FileId, ExprId)>,
    readers: FxHashSet<(FileId, FileId)>,
    imported_by_es_modules: FxHashSet<(FileId, FileId)>,
    starred: Vec<(FileId, ExprId, FileId)>,
    awaited: Vec<FileId>,
    is_cache_read: bool,
    are_children_read: bool,
}

impl Uses {
    fn append(&mut self, mut more: Uses) {
        self.mentions.append(&mut more.mentions);
        self.looked_at.append(&mut more.looked_at);
        self.methods.append(&mut more.methods);
        self.required_by_functions
            .extend(more.required_by_functions);
        self.requires_of_evaluated_modules
            .extend(more.requires_of_evaluated_modules);
        self.readers.extend(more.readers);
        self.imported_by_es_modules
            .extend(more.imported_by_es_modules);
        self.starred.append(&mut more.starred);
        self.awaited.append(&mut more.awaited);
        self.is_cache_read |= more.is_cache_read;
        self.are_children_read |= more.are_children_read;
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub fn set_resolved_imports(
        &self,
        modules: &[FileId],
        resolved: Vec<((FileId, Atom), FileId)>,
        require_resolutions: Vec<((FileId, Atom), FileId)>,
        reevaluated: Vec<FileId>,
        folded: Vec<((FileId, StmtId), bool)>,
        implicit: Vec<(FileId, FileId)>,
        entry_points: Vec<FileId>,
        preserves_source_paths: bool,
    ) {
        self.p.aot.commonjs.graph.get_or_init(|| Graph {
            modules: modules.to_vec(),
            resolved: resolved.into_iter().collect(),
            require_resolutions: require_resolutions.into_iter().collect(),
            reevaluated: reevaluated.into_iter().collect(),
            folded: folded.into_iter().collect(),
            implicit,
            entry_points,
            preserves_source_paths,
        });
    }

    pub fn preserves_source_paths(&self) -> bool {
        self.p
            .aot
            .commonjs
            .graph
            .get()
            .is_some_and(|graph| graph.preserves_source_paths)
    }

    pub fn export_variable_names(&mut self, module: FileId) -> Vec<Atom> {
        if self.aot.commonjs.export_variable_names.is_none() {
            let found = self.commonjs();
            let mut names: FxHashMap<FileId, Vec<Atom>> = FxHashMap::default();
            for &(of, name) in found.stores.keys().chain(found.aliases.keys()) {
                names.entry(of).or_default().push(name);
            }
            for &of in found.marked.keys() {
                names.entry(of).or_default().push(known::__esModule);
            }
            self.aot.commonjs.export_variable_names = Some(names);
        }
        self.aot
            .commonjs
            .export_variable_names
            .as_ref()
            .and_then(|names| names.get(&module))
            .cloned()
            .unwrap_or_default()
    }

    pub fn resolve_export_variable(&mut self, module: FileId, name: Atom) -> (FileId, Atom) {
        self.commonjs()
            .aliases
            .get(&(module, name))
            .copied()
            .unwrap_or((module, name))
    }

    fn is_required_only(&self, importer: FileId, specifier: Atom) -> bool {
        let hir = self.hir(importer);
        !hir.specifier_uses.iter().any(|used| used.spec == specifier)
            && self
                .file_exprs_by_kind(importer)
                .of(ExprTag::Call)
                .iter()
                .any(|&e| {
                    required_specifier(hir, e) == Some(specifier)
                        || hir.folded_require_specifiers(e).contains(&specifier)
                })
    }

    pub(super) fn importers_with_other_declarations(&self) -> FxHashMap<FileId, Place> {
        let mut first_of: FxHashMap<FileId, Place> = FxHashMap::default();
        let Some(graph) = self.p.aot.commonjs.graph.get() else {
            return first_of;
        };
        for (&(importer, specifier), &code) in &graph.resolved {
            if self.is_untyped_file(code)
                || self.is_untyped_file(importer)
                || matches!(self.hir(code).kind, FileKind::Declaration | FileKind::Json)
            {
                continue;
            }
            match self.files.module_of_specifier(importer, specifier) {
                Some(seen) if seen.file == code => continue,
                None if self.is_required_only(importer, specifier) => continue,
                _ => {}
            }
            let pos = self
                .hir(importer)
                .specifier_uses
                .iter()
                .find(|used| used.spec == specifier)
                .map_or(0, |used| used.pos);
            let (at, first) = (
                Place {
                    file: importer,
                    pos,
                },
                first_of.entry(code).or_insert(Place {
                    file: importer,
                    pos,
                }),
            );
            if at < *first {
                *first = at;
            }
        }
        first_of
    }

    pub(super) fn is_entry_point(&self, file: FileId) -> bool {
        self.p
            .aot
            .commonjs
            .graph
            .get()
            .is_some_and(|graph| graph.entry_points.contains(&file))
    }

    pub(super) fn is_reached_by_import(&self, file: FileId) -> bool {
        let Some(graph) = self.p.aot.commonjs.graph.get() else {
            return false;
        };
        let reached = self.p.aot.commonjs.reached_by_import.get_or_init(|| {
            let mut reached = FxHashSet::default();
            for &importer in &graph.modules {
                for used in self.hir(importer).specifier_uses.iter() {
                    if matches!(
                        used.kind,
                        SpecifierKind::Import
                            | SpecifierKind::SideEffect
                            | SpecifierKind::ImportCall
                    ) && let Some(&imported) = graph.resolved.get(&(importer, used.spec))
                    {
                        reached.insert(imported);
                    }
                }
            }
            reached
        });
        reached.contains(&file)
    }

    pub(super) fn is_in_commonjs_package(&self, file: FileId) -> bool {
        let directory = self.files().module(file).package_json_directory;
        directory.is_some()
            && self
                .files()
                .package_jsons
                .get(self.atoms().bytes(directory))
                .and_then(|json| json.get(b"type"))
                .and_then(|kind| kind.as_str())
                == Some(&b"commonjs"[..])
    }

    pub fn is_in_module_package(&self, file: FileId) -> bool {
        let directory = self.files().module(file).package_json_directory;
        directory.is_some()
            && self
                .files()
                .package_jsons
                .get(self.atoms().bytes(directory))
                .and_then(|json| json.get(b"type"))
                .and_then(|kind| kind.as_str())
                == Some(&b"module"[..])
    }

    #[allow(
        clippy::disallowed_methods,
        reason = "a package.json that no file of the program belongs to is not among those that were read"
    )]
    pub fn is_in_side_effect_free_package(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        if module.package_json_directory.is_none() {
            return false;
        }
        let says = |directory: &[u8]| {
            let json = self.files().package_jsons.get(directory)?;
            let has_name = json
                .get(b"name")
                .and_then(|name| name.as_str())
                .is_some_and(|name| !name.is_empty());
            Some((
                has_name,
                matches!(
                    json.get(b"sideEffects"),
                    Some(crate::json::Json::Bool(false))
                ),
            ))
        };
        let nearest = self.atoms().bytes(module.package_json_directory);
        let path = module.file_name();
        let root = crate::resolve::node_module_path_parts(path).map(|(_, _, end)| &path[..end]);
        if root.is_some_and(|root| !matches!(says(root), Some((_, true)))) {
            return false;
        }
        match says(nearest) {
            Some((true, is_licensed)) => is_licensed,
            Some((false, _)) => {
                let Some(root) = root else { return false };
                if says(root) != Some((true, true)) || !nearest.starts_with(root) {
                    return false;
                }
                let mut between = nearest;
                loop {
                    between = &between
                        [..bun_core::strings::last_index_of_char(between, b'/').unwrap_or(0)];
                    if between.len() <= root.len() {
                        return between == root;
                    }
                    if std::fs::metadata(
                        bstr::BStr::new(&[between, b"/package.json"].concat()).to_string(),
                    )
                    .is_ok()
                    {
                        return false;
                    }
                }
            }
            None => false,
        }
    }

    fn ignores_es_module_marker(&self, importer: FileId, module: FileId) -> bool {
        match self.p.aot.commonjs.graph.get() {
            Some(graph) if graph.preserves_source_paths => self.is_in_module_package(module),
            _ => self.files().module(importer).implied_format == ResolutionMode::Import,
        }
    }

    pub fn commonjs_exports(&mut self, file: FileId) -> CommonJsExports {
        self.commonjs()
            .exports
            .get(&file)
            .copied()
            .unwrap_or(CommonJsExports::Object)
    }

    pub fn module_with_export_variables(&mut self, file: FileId) -> Option<FileId> {
        let found = self.commonjs();
        let mut at = file;
        loop {
            match found.exports.get(&at)? {
                CommonJsExports::Object | CommonJsExports::Value => return None,
                CommonJsExports::Variables => return Some(at),
                CommonJsExports::Of(other) => at = *other,
            }
        }
    }

    pub fn has_exports_expressions(&mut self, file: FileId) -> bool {
        let found = self.commonjs();
        let files = self
            .p
            .aot
            .commonjs
            .files_with_exports_expressions
            .get_or_init(|| {
                let by_expression = found
                    .mentions
                    .keys()
                    .chain(&found.alias_definitions)
                    .chain(&found.stars)
                    .chain(&found.whole)
                    .map(|at| at.0);
                by_expression.chain(found.marked.keys().copied()).collect()
            });
        files.contains(&file)
    }

    pub fn exports_reference(&mut self, file: FileId, e: ExprId) -> Option<ExportsReference> {
        self.commonjs().mentions.get(&(file, e)).copied()
    }

    pub fn marks_export_variables(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().marked.get(&file) == Some(&call)
    }

    pub fn export_variable_for_expr(&mut self, file: FileId, e: ExprId) -> Option<(FileId, Atom)> {
        let hir = self.hir(file);
        let (obj, name) = match hir[e].kind {
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => (obj, name),
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => (obj, string_literal_text(hir, index)),
            _ => return None,
        };
        let mention = self.exports_reference(file, obj)?;
        if mention.is_namespace {
            return self.imported_export_variable(file, mention.module, name);
        }
        if mention.is_boxed {
            return None;
        }
        if self.bound(file).get_assignment_target(hir, e).is_some() {
            return Some((self.module_with_export_variables(mention.module)?, name));
        }
        self.export_variable_for(mention.module, name)
    }

    pub fn is_initialized_at_every_read(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (Some(&prologue), ExprKind::Ident(name)) =
            (self.commonjs().prologues.get(&file), hir[e].kind)
        else {
            return false;
        };
        let Some((of, Decl::Var(pat))) = self
            .identifier_binding(file, e, name)
            .and_then(|sym| self.variable_declaration(sym))
        else {
            return false;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        if hir[declaration].init.is_none() {
            let Some(end) = self
                .single_store_end(file, bound.pat_symbol[pat.idx()])
                .filter(|_| of == file)
            else {
                return false;
            };
            return if self.enclosing_fn_of_expr(file, e).is_some() {
                end <= prologue
            } else {
                hir[e].pos >= end
            };
        }
        let end = hir[declaration].loc.end;
        of == file
            && end <= prologue
            && self
                .enclosing_fn(file, Parent::VarInit(declaration))
                .is_none()
            && (self.enclosing_fn_of_expr(file, e).is_some() || hir[e].pos >= end)
    }

    fn single_store_end(&self, file: FileId, local: crate::bind::SymbolId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let graph = self.p.aot.commonjs.graph.get()?;
        let mut stores = bound
            .assignments_to(local)
            .iter()
            .filter_map(|&(_, target)| match bound.expr_parent[target.idx()] {
                Parent::Expr(around) if self.runs(file, graph, around) == Execution::Never => None,
                Parent::Expr(around) => Some(around),
                _ => Some(ExprId::NONE),
            });
        let (store, None) = (stores.next()?, stores.next()) else {
            return None;
        };
        (store.is_some() && self.runs(file, graph, store) == Execution::Always)
            .then(|| hir[store].end)
    }

    pub fn is_export_star_of_variables(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().stars.contains(&(file, call))
    }

    pub fn export_variable_for(&mut self, module: FileId, name: Atom) -> Option<(FileId, Atom)> {
        let keeper = self.module_with_export_variables(module)?;
        Some(
            self.commonjs()
                .aliases
                .get(&(keeper, name))
                .copied()
                .unwrap_or((keeper, name)),
        )
    }

    pub fn defines_export_variable_alias(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().alias_definitions.contains(&(file, call))
    }

    pub fn is_export_variables_literal(&mut self, file: FileId, literal: ExprId) -> bool {
        let is_literal_name = self
            .commonjs()
            .named_literals
            .get(&file)
            .is_some_and(|named| named.1 == literal);
        (is_literal_name || matches!(self.hir(file)[literal].kind, ExprKind::Object(_)))
            && self.commonjs_exports(file) == CommonJsExports::Variables
    }

    pub fn is_named_export_variables_literal(&mut self, file: FileId, literal: ExprId) -> bool {
        self.commonjs()
            .named_literals
            .get(&file)
            .is_some_and(|named| named.0 == literal)
    }

    pub fn is_value_only_module(&mut self, module: FileId) -> bool {
        self.commonjs().value_only_modules.contains(&module)
    }

    pub fn is_export_variable_stored_before_every_read(
        &mut self,
        module: FileId,
        name: Atom,
    ) -> bool {
        let found = self.commonjs();
        found.value_only_modules.contains(&module)
            && found
                .stores
                .get(&(module, name))
                .is_some_and(|stores| stores.len() == 1)
    }

    pub fn imported_export_variable(
        &mut self,
        importer: FileId,
        module: FileId,
        name: Atom,
    ) -> Option<(FileId, Atom)> {
        let keeper = self.module_with_export_variables(module)?;
        (name != known::default || self.has_own_default_property(importer, module, keeper)).then(
            || {
                self.commonjs()
                    .aliases
                    .get(&(keeper, name))
                    .copied()
                    .unwrap_or((keeper, name))
            },
        )
    }

    fn has_own_default_property(
        &mut self,
        importer: FileId,
        module: FileId,
        keeper: FileId,
    ) -> bool {
        let found = self.commonjs();
        !self.ignores_es_module_marker(importer, module)
            && found.marked.contains_key(&keeper)
            && (found.stores.contains_key(&(keeper, known::default))
                || found.aliases.contains_key(&(keeper, known::default)))
    }

    pub fn export_variable_single_function(
        &mut self,
        module: FileId,
        name: Atom,
    ) -> Option<(FileId, FnId, bool)> {
        self.export_variable_function(module, name, 0)
    }

    pub(super) fn export_variable_function(
        &mut self,
        module: FileId,
        name: Atom,
        depth: u32,
    ) -> Option<(FileId, FnId, bool)> {
        let stores = self.commonjs().stores.get(&(module, name))?;
        let (mut callee, mut is_predicted) = (Callee::Nothing, false);
        for &value in stores {
            if value.is_none() {
                return None;
            }
            let produced = self.result_callees_of(module, value, depth);
            callee = callee.join(produced.callee);
            is_predicted |= produced.is_predicted;
        }
        match callee {
            Callee::One(file, func) => Some((
                file,
                func,
                is_predicted || self.is_inside_cloneable_function(file, func, &[]),
            )),
            _ => None,
        }
    }

    pub fn is_module_exports_variable(&mut self, file: FileId, e: ExprId) -> bool {
        self.commonjs().whole.contains(&(file, e))
    }

    pub fn module_exports_function(&mut self, module: FileId) -> Option<(FileId, FnId, bool)> {
        if let Some(&known) = self.aot.commonjs.whole_export_functions.get(&module) {
            return known;
        }
        self.aot
            .commonjs
            .whole_export_functions
            .insert(module, None);
        let values = self.commonjs().values.get(&module);
        let mut is_sure = self.commonjs().stored_once.contains(&module);
        let callee = self.outside_variable_query(|this| {
            values
                .into_iter()
                .flatten()
                .fold(Callee::Nothing, |callee, &value| {
                    if value.is_none() {
                        return callee.join(Callee::Unknown(Place {
                            file: module,
                            pos: 0,
                        }));
                    }
                    let produced = this.result_callees_of(module, value, 0);
                    is_sure &= !produced.is_predicted && !produced.may_be_nullish;
                    callee.join(produced.callee)
                })
        });
        let found = match callee {
            Callee::One(file, func) => Some((file, func, is_sure)),
            _ => None,
        };
        self.aot
            .commonjs
            .whole_export_functions
            .insert(module, found);
        found
    }

    pub(super) fn required_function(
        &mut self,
        file: FileId,
        e: ExprId,
    ) -> Option<(FileId, FnId, bool)> {
        let hir = self.hir(file);
        let (specifier, ExprKind::Call(call)) = (required_specifier(hir, e)?, hir[e].kind) else {
            return None;
        };
        let module = self.p.aot.commonjs.graph.get()?.required(file, specifier)?;
        if self.commonjs_exports(module) != CommonJsExports::Value
            || !self.is_commonjs_variable_ref(file, hir[call].callee, known::require)
        {
            return None;
        }
        let is_already_evaluated = self
            .commonjs()
            .requires_of_evaluated_modules
            .contains(&(file, e));
        self.module_exports_function(module)
            .map(|(of, func, is_sure)| (of, func, is_sure && is_already_evaluated))
    }

    pub fn explain_commonjs(&mut self) -> Vec<String> {
        let found = self.commonjs();
        let count = |of: fn(&CommonJsExports) -> bool| {
            found
                .exports
                .values()
                .filter(|retained| of(retained))
                .count()
        };
        let mut lines = vec![format!(
            "commonjs: modules {}: variables {}, re-exports of such {}, module.exports is a variable {} (stored once, with the body: {}), `module` is an object {}; variables {}, other names for them {}; places that stand for exports {}; calls of require that find a module evaluated {}",
            found.exports.len(),
            count(|retained| *retained == CommonJsExports::Variables),
            count(|retained| matches!(retained, CommonJsExports::Of(_))),
            count(|retained| *retained == CommonJsExports::Value),
            found.stored_once.len(),
            count(|retained| *retained == CommonJsExports::Object),
            found.stores.len(),
            found.aliases.len(),
            found.mentions.len(),
            found.requires_of_evaluated_modules.len()
        )];
        lines.extend(found.obstacles.iter().map(|(why, modules)| {
            format!(
                "commonjs: {}, {modules}: {why}",
                if why.starts_with("module.exports =") {
                    "one value"
                } else {
                    "an object"
                }
            )
        }));
        lines.extend(
            found
                .module_object_reasons
                .iter()
                .map(|(why, modules)| format!("commonjs: `module`, {modules}: {why}")),
        );
        lines
    }

    fn commonjs(&mut self) -> &'p Found {
        let program = self.p;
        if let Some(found) = program.aot.commonjs.found.get() {
            return found;
        }
        program
            .aot
            .commonjs
            .found
            .get_or_init(|| self.find_commonjs(None))
    }

    pub fn are_module_children_read(&mut self) -> bool {
        self.commonjs().are_children_read
    }

    pub fn finalize_commonjs(&mut self, in_parallel: InParallel<'_>) {
        let program = self.p;
        program
            .aot
            .commonjs
            .found
            .get_or_init(|| self.find_commonjs(Some(in_parallel)));
    }

    fn find_commonjs(&mut self, in_parallel: Option<InParallel<'_>>) -> Found {
        let program = self.p;
        let Some(graph) = program.aot.commonjs.graph.get() else {
            return Found::default();
        };
        let is_looked_into = |file: &FileId| {
            let module = self.files().module(*file);
            module.is_commonjs()
                && module.builtin.is_none()
                && self.hir(*file).kind != FileKind::Json
        };
        let looked_into: Vec<FileId> = graph
            .modules
            .iter()
            .copied()
            .filter(is_looked_into)
            .collect();
        let found = self.map_slices(&looked_into, FILES_PER_CHECKER, in_parallel, &|c, files| {
            files
                .iter()
                .map(|&file| c.find_commonjs_module(file, graph))
                .collect::<Vec<Module>>()
        });
        let mut modules: FxHashMap<FileId, Module> = FxHashMap::default();
        for (&file, found) in looked_into.iter().zip(found.into_iter().flatten()) {
            modules.insert(file, found);
        }
        for &file in &graph.modules {
            if let Some(other) = modules.get(&file).and_then(|module| module.re_exports)
                && !modules.contains_key(&other)
                && let Some(module) = modules.get_mut(&file)
            {
                module.obstacle = module.obstacle.or(Some(
                    "it re-exports something that is not a CommonJS module",
                ));
            }
        }
        let holder_by_symbol = |modules: &FxHashMap<FileId, Module>, file: FileId| {
            let (mut at, mut steps) = (file, 0);
            while let Some(other) = modules
                .get(&at)
                .filter(|module| module.obstacle.is_none())
                .and_then(|module| module.re_exports)
            {
                steps += 1;
                if steps > modules.len() {
                    break;
                }
                at = other;
            }
            at
        };
        let in_cycles = modules_in_cycles(graph);
        let is_in_cycle_with = |a: FileId, b: FileId| {
            in_cycles
                .get(&a)
                .is_some_and(|cycle| in_cycles.get(&b) == Some(cycle))
        };
        let exposed = self.modules_exposed(graph, in_parallel);
        let found = self.map_slices(
            &graph.modules,
            FILES_PER_CHECKER,
            in_parallel,
            &|c, files| {
                let mut uses = Uses::default();
                for &file in files {
                    c.record_commonjs_module_uses(
                        file,
                        graph,
                        &modules,
                        &holder_by_symbol,
                        &in_cycles,
                        &exposed,
                        &mut uses,
                    );
                }
                uses
            },
        );
        let mut uses = Uses::default();
        for more in found {
            uses.append(more);
        }
        uses.imported_by_es_modules
            .extend(graph.implicit.iter().copied());
        let accessed = uses
            .readers
            .iter()
            .copied()
            .chain(uses.imported_by_es_modules.iter().copied());
        let accessed_early: FxHashSet<FileId> = accessed
            .filter(|&(by, module)| is_in_cycle_with(by, module) || exposed.contains(&by))
            .map(|(_, module)| module)
            .chain(uses.required_by_functions.iter().copied())
            .collect();
        let mut with_object: FxHashMap<FileId, &'static str> = FxHashMap::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else {
                continue;
            };
            if let Some(why) = module.obstacle {
                with_object.entry(file).or_insert(why);
                if let Some(other) = module.re_exports {
                    with_object
                        .entry(holder_by_symbol(&modules, other))
                        .or_insert("a module that keeps its object re-exports it");
                }
            }
            if module.re_exports.is_some() && !module.is_redirect && accessed_early.contains(&file)
            {
                with_object
                    .entry(holder_by_symbol(&modules, file))
                    .or_insert("what re-exports it may be got at while it is evaluated");
            }
        }
        for &(module, why) in &uses.looked_at {
            with_object
                .entry(holder_by_symbol(&modules, module))
                .or_insert(why);
        }
        let aliasing: FxHashMap<(FileId, ExprId), ExportsReference> = uses
            .mentions
            .iter()
            .map(|&(file, e, mention)| ((file, e), mention))
            .collect();
        let mut aliases: FxHashMap<(FileId, Atom), (FileId, Atom)> = FxHashMap::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else {
                continue;
            };
            if module.literal.is_some()
                && accessed_early.contains(&file)
                && !self.module_only_creates_values(file)
            {
                with_object.entry(file).or_insert(
                    "module.exports = { .. }, and it may be got at while it is evaluated",
                );
            }
            let hir = self.hir(file);
            for (&name, &(_, value)) in &module.getters {
                let read = match hir[value].kind {
                    ExprKind::Dot {
                        obj,
                        name,
                        chain: Chain::No,
                        ..
                    } => Some((obj, name)),
                    ExprKind::Index {
                        obj,
                        index,
                        chain: Chain::No,
                    } => {
                        Some((obj, string_literal_text(hir, index))).filter(|read| read.1.is_some())
                    }
                    _ => None,
                };
                let read =
                    read.filter(|read| self.is_initialized_once_evaluated(file, graph, read.0));
                match read.and_then(|(obj, other)| {
                    Some((
                        aliasing
                            .get(&(file, obj))
                            .filter(|mention| !mention.is_namespace && !mention.is_boxed)?
                            .module,
                        other,
                    ))
                }) {
                    Some(other) => {
                        aliases.insert((file, name), other);
                    }
                    None => {
                        with_object
                            .entry(file)
                            .or_insert("a getter that is not an alias of an export");
                    }
                }
            }
        }
        let mut stars: FxHashMap<FileId, Vec<(ExprId, FileId)>> = FxHashMap::default();
        for &(file, call, other) in &uses.starred {
            match modules
                .get(&file)
                .filter(|module| module.obstacle.is_none() && module.stars.contains(&call))
            {
                Some(_) => stars.entry(file).or_default().push((call, other)),
                None => {
                    with_object
                        .entry(holder_by_symbol(&modules, other))
                        .or_insert("it is passed to __exportStar, which stores to an object");
                }
            }
        }
        for (&file, starred) in &mut stars {
            let hir = self.hir(file);
            starred.sort_unstable_by_key(|star| hir[star.0].pos);
        }
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else {
                continue;
            };
            if module.is_exact_outside_cycles && accessed_early.contains(&file) {
                with_object.entry(file).or_insert(
                    "a getter or __exportStar, and it may be got at while it is evaluated",
                );
            }
            if stars.get(&file).into_iter().flatten().any(|star| {
                is_in_cycle_with(file, star.1)
                    || is_in_cycle_with(file, holder_by_symbol(&modules, star.1))
            }) {
                with_object
                    .entry(file)
                    .or_insert("__exportStar of a module of its cycle");
            }
            if module.stars.len() != stars.get(&file).map_or(0, Vec::len) {
                with_object.entry(file).or_insert(
                    "__exportStar of something that is not a CommonJS module of the program",
                );
            }
        }
        let mut keys: FxHashMap<FileId, Vec<Atom>> = FxHashMap::default();
        loop {
            let before = keys.len();
            for &file in &graph.modules {
                let Some(module) = modules
                    .get(&file)
                    .filter(|module| module.re_exports.is_none() && !keys.contains_key(&file))
                else {
                    continue;
                };
                let starred = stars.get(&file).map_or(&[][..], |starred| &starred[..]);
                if !starred
                    .iter()
                    .all(|star| keys.contains_key(&holder_by_symbol(&modules, star.1)))
                {
                    continue;
                }
                let hir = self.hir(file);
                let mut own: Vec<Atom> = module
                    .stores
                    .keys()
                    .chain(module.getters.keys())
                    .copied()
                    .filter(|&name| name != known::__esModule)
                    .collect();
                for &(call, other) in starred {
                    for &name in &keys[&holder_by_symbol(&modules, other)] {
                        if name == known::default
                            || aliases.contains_key(&(file, name))
                                && !module.getters.contains_key(&name)
                        {
                            continue;
                        }
                        if module.reads.contains(&name)
                            || module.stores.get(&name).is_some_and(|stores| {
                                stores.iter().any(|store| store.runs != Execution::Always)
                            })
                        {
                            with_object.entry(file).or_insert("a name that __exportStar may bring is read by the module itself, or stored to late or not always");
                        }
                        let defined = (module
                            .stores
                            .get(&name)
                            .into_iter()
                            .flatten()
                            .map(|store| store.value))
                        .chain(module.getters.get(&name).map(|getter| getter.0));
                        match defined
                            .map(|e| if e.is_some() { hir[e].pos } else { u32::MAX })
                            .min()
                        {
                            Some(pos) if pos < hir[call].pos => {}
                            Some(_) => {
                                with_object
                                    .entry(file)
                                    .or_insert("a name is defined after __exportStar has");
                            }
                            None => {
                                aliases.insert((file, name), (other, name));
                                own.push(name);
                            }
                        }
                    }
                }
                keys.insert(file, own);
            }
            if keys.len() == before {
                break;
            }
        }
        for &module in &uses.awaited {
            let keeper = holder_by_symbol(&modules, module);
            if modules
                .get(&keeper)
                .is_some_and(|retained| retained.has(known::then))
                || aliases.contains_key(&(keeper, known::then))
            {
                with_object
                    .entry(keeper)
                    .or_insert("it exports `then`, and an import() of it is awaited");
            }
        }
        for (&file, starred) in &stars {
            let is_sure = |other: FileId| {
                modules.get(&other).is_some_and(|other| {
                    other
                        .stores
                        .values()
                        .all(|stores| stores.iter().any(|store| store.runs == Execution::Always))
                })
            };
            if !keys.contains_key(&file)
                || !starred
                    .iter()
                    .all(|star| is_sure(holder_by_symbol(&modules, star.1)))
            {
                with_object
                    .entry(file)
                    .or_insert("__exportStar of a module that may or may not have a name");
            }
        }
        let variable_of = |modules: &FxHashMap<FileId, Module>, module: FileId, name: Atom| {
            let (mut module, mut name) = (module, name);
            for _ in 0..64 {
                let keeper = holder_by_symbol(modules, module);
                match aliases.get(&(keeper, name)) {
                    Some(&other) => (module, name) = other,
                    None => return Some((keeper, name)),
                }
            }
            None
        };
        let own_methods: Vec<(FileId, Atom)> = graph
            .modules
            .iter()
            .flat_map(|&file| {
                modules
                    .get(&file)
                    .into_iter()
                    .flat_map(move |module| module.methods.iter().map(move |&name| (file, name)))
            })
            .collect();
        for &(module, name) in uses.methods.iter().chain(&own_methods) {
            let Some((keeper, stored_as)) = variable_of(&modules, module, name) else {
                continue;
            };
            let files = self.files();
            let named_by = |file: FileId, member: ExprId| {
                let hir = files.hir(file);
                let (obj, name) = match hir[member].kind {
                    ExprKind::Dot {
                        obj,
                        name,
                        chain: Chain::No,
                        ..
                    } => (obj, name),
                    _ => return None,
                };
                let mention = aliasing
                    .get(&(file, obj))
                    .filter(|mention| !mention.is_namespace && !mention.is_boxed)?;
                let (of, name) = variable_of(&modules, mention.module, name)?;
                Some((
                    of,
                    modules
                        .get(&of)?
                        .stores
                        .get(&name)
                        .into_iter()
                        .flatten()
                        .map(|store| store.value)
                        .collect::<Vec<ExprId>>(),
                ))
            };
            if let Some(value) = modules
                .get(&keeper)
                .and_then(|module| module.stores.get(&stored_as))
                .into_iter()
                .flatten()
                .map(|store| store.value)
                .find(|&value| value.is_none() || !self.ignores_this(keeper, value, 0, &named_by))
            {
                with_object.entry(holder_by_symbol(&modules, module)).or_insert_with(|| match value.some().map(|value| self.hir(keeper)[value].kind) {
                    Some(ExprKind::Fn(_)) => "a method call hands it to a function that mentions `this`",
                    Some(ExprKind::Ident(_)) => "a method call hands it to what a name holds, which may look at `this`",
                    Some(ExprKind::Call(_) | ExprKind::New(_)) => "a method call passes it to the result of a call, which may inspect `this`",
                    Some(ExprKind::Dot { .. } | ExprKind::Index { .. }) => "a method call hands it to a property of something, which may look at `this`",
                    _ => "a method call hands it to a value that may look at `this`",
                });
            }
        }
        let mut imported: Vec<(FileId, FileId)> =
            uses.imported_by_es_modules.iter().copied().collect();
        imported.sort_unstable();
        let mut aliased_names: FxHashMap<FileId, Vec<Atom>> = FxHashMap::default();
        for &(file, name) in aliases.keys() {
            aliased_names.entry(file).or_default().push(name);
        }
        for (importer, module) in imported {
            let keeper = holder_by_symbol(&modules, module);
            let Some(retained) = modules.get(&keeper) else {
                continue;
            };
            let others: Vec<Option<(FileId, Atom)>> = aliased_names
                .get(&keeper)
                .into_iter()
                .flatten()
                .map(|&name| variable_of(&modules, keeper, name))
                .collect();
            let is_settled = |other: &Option<(FileId, Atom)>| {
                other.is_some_and(|(of, name)| {
                    modules.get(&of).is_some_and(|of| {
                        of.stores.get(&name).is_none_or(|stores| {
                            stores.iter().all(|store| store.runs != Execution::Later)
                                && stores.iter().any(|store| store.runs == Execution::Always)
                        })
                    })
                })
            };
            if !retained.is_settled() || !others.iter().all(is_settled) {
                with_object.entry(keeper).or_insert(
                    "an ES module imports it, and a name is stored to late or not always",
                );
            } else if is_in_cycle_with(importer, keeper)
                || is_in_cycle_with(importer, module)
                || exposed.contains(&importer)
                || accessed_early.contains(&keeper) && retained.is_exact_outside_cycles
            {
                with_object
                    .entry(keeper)
                    .or_insert("an ES module imports it that may run while it is evaluated");
            }
        }
        let mut named: Vec<(FileId, Atom)> = aliases.keys().copied().collect();
        named.sort_unstable_by_key(|alias| alias.0);
        loop {
            let before = with_object.len();
            for &(file, name) in &named {
                if variable_of(&modules, file, name)
                    .is_none_or(|other| with_object.contains_key(&other.0))
                {
                    with_object
                        .entry(file)
                        .or_insert("a getter reads from a module that keeps its object");
                }
            }
            for &(file, _, other) in &uses.starred {
                let other = holder_by_symbol(&modules, other);
                match (
                    with_object.contains_key(&file),
                    with_object.contains_key(&other),
                ) {
                    (true, false) => {
                        with_object.insert(
                            other,
                            "it is passed to __exportStar, which stores to an object",
                        );
                    }
                    (false, true) => {
                        with_object.insert(file, "__exportStar of a module that keeps its object");
                    }
                    _ => {}
                }
            }
            if with_object.len() == before {
                break;
            }
        }
        let mut found = Found::default();
        let (mut obstacles, mut module_object_reasons): (
            FxHashMap<&'static str, u32>,
            FxHashMap<&'static str, u32>,
        ) = Default::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else {
                continue;
            };
            let keeper = holder_by_symbol(&modules, file);
            if let Some(why) = with_object.get(&file).or_else(|| with_object.get(&keeper)) {
                *obstacles.entry(why).or_default() += 1;
                if self.module_only_creates_values(file) {
                    found.value_only_object_modules.insert(file);
                }
                if let Some(why) = module.module_object_reason {
                    found.exports.insert(file, CommonJsExports::Object);
                    *module_object_reasons.entry(why).or_default() += 1;
                    continue;
                }
                found.exports.insert(file, CommonJsExports::Value);
                let hir = self.hir(file);
                found.whole.extend(
                    module
                        .mentions
                        .iter()
                        .filter(|&&e| !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This))
                        .map(|&e| (file, e)),
                );
                found.values.insert(file, module.values.clone());
                if module.values.len() == 1
                    && module.values[0].is_some()
                    && module.unconditional_value_stores == 1
                {
                    found.stored_once.insert(file);
                }
                continue;
            }
            found.exports.insert(
                file,
                module
                    .re_exports
                    .map_or(CommonJsExports::Variables, CommonJsExports::Of),
            );
            found.mentions.extend(
                module
                    .mentions
                    .iter()
                    .map(|&e| ((file, e), ExportsReference::new(file))),
            );
            if module.is_marked() {
                found.marked.insert(file, module.marker);
            }
            for (&name, stores) in &module.stores {
                found.stores.insert(
                    (file, name),
                    stores.iter().map(|store| store.value).collect(),
                );
            }
            found
                .alias_definitions
                .extend(module.getters.values().map(|getter| (file, getter.0)));
            found
                .stars
                .extend(module.stars.iter().map(|&call| (file, call)));
            if self.module_only_creates_values(file)
                && !uses
                    .imported_by_es_modules
                    .iter()
                    .any(|import| holder_by_symbol(&modules, import.1) == file)
            {
                found.value_only_modules.insert(file);
            }
            if module.name_of_literal.is_some() {
                found
                    .named_literals
                    .insert(file, (module.literal, module.name_of_literal));
            }
        }
        for &(file, name) in &named {
            if !with_object.contains_key(&file) {
                found
                    .aliases
                    .extend(variable_of(&modules, file, name).map(|other| ((file, name), other)));
            }
        }
        if !uses.is_cache_read {
            found.requires_of_evaluated_modules =
                std::mem::take(&mut uses.requires_of_evaluated_modules);
        }
        found.are_children_read = uses.is_cache_read || uses.are_children_read;
        for (file, e, mention) in uses.mentions {
            if !with_object.contains_key(&holder_by_symbol(&modules, mention.module)) {
                found.mentions.insert((file, e), mention);
            }
        }
        for &file in &graph.modules {
            if !in_cycles.contains_key(&file)
                && !accessed_early.contains(&file)
                && self.files().module(file).is_commonjs()
                && !self.has_direct_eval(file)
            {
                let end = self.prologue_end(file, graph);
                found.prologues.insert(file, end);
            }
        }
        found.obstacles = obstacles.into_iter().collect();
        found
            .obstacles
            .sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        found.module_object_reasons = module_object_reasons.into_iter().collect();
        found
            .module_object_reasons
            .sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        found
    }

    fn is_builtin_module_specifier(&self, specifier: Atom, module: &[u8]) -> bool {
        if specifier.is_none() {
            return false;
        }
        let text = self.atoms().bytes(specifier);
        text.strip_prefix(b"node:").unwrap_or(text) == module
    }

    fn is_builtin_module_object(&mut self, file: FileId, e: ExprId, module: &[u8]) -> bool {
        let hir = self.hir(file);
        if let Some(specifier) = required_specifier(hir, e) {
            return self.is_builtin_module_specifier(specifier, module);
        }
        let ExprKind::Ident(name) = hir[e].kind else {
            return false;
        };
        let Some(sym) = self.identifier_binding(file, e, name) else {
            return false;
        };
        if let Some((of, init)) = self.initializer_of_const(sym) {
            return required_specifier(self.hir(of), init)
                .is_some_and(|specifier| self.is_builtin_module_specifier(specifier, module));
        }
        self.files()
            .decls_of(sym)
            .iter()
            .copied()
            .any(|(of, decl)| match decl {
                Decl::ImportNamespace(import) | Decl::ImportDefault(import) => {
                    self.is_builtin_module_specifier(self.hir(of)[import].spec, module)
                }
                _ => false,
            })
    }

    fn is_builtin_module_member(
        &mut self,
        file: FileId,
        callee: ExprId,
        module: &[u8],
        member: Atom,
    ) -> bool {
        let hir = self.hir(file);
        let name = match hir[callee].kind {
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => return name == member && self.is_builtin_module_object(file, obj, module),
            ExprKind::Ident(name) => name,
            _ => return false,
        };
        let Some(sym) = self.identifier_binding(file, callee, name) else {
            return false;
        };
        self.files()
            .decls_of(sym)
            .iter()
            .copied()
            .any(|(of, decl)| {
                let (hir, bound) = (self.hir(of), self.bound(of));
                match decl {
                    Decl::ImportSpec(spec) => {
                        hir[spec].imported == member
                            && self.is_builtin_module_specifier(hir[hir[spec].import].spec, module)
                    }
                    Decl::Var(pat) | Decl::Require(pat) => match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, prop) => {
                            let is_the_property = match (hir[prop].key, hir[pat].kind) {
                                (PropKey::Name(key), _) | (PropKey::None, PatKind::Ident(key)) => {
                                    key == member
                                }
                                _ => false,
                            };
                            let PatParent::Var(declaration) = bound.pat_parent[outer.idx()] else {
                                return false;
                            };
                            is_the_property
                                && required_specifier(hir, hir[declaration].init).is_some_and(
                                    |specifier| self.is_builtin_module_specifier(specifier, module),
                                )
                        }
                        _ => false,
                    },
                    _ => false,
                }
            })
    }

    fn refers_to_own_file_path(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let is_import_meta = |e: ExprId, names: &[&[u8]]| matches!(hir[e].kind, ExprKind::Dot { obj, name, chain: Chain::No, .. } if matches!(hir[obj].kind, ExprKind::ImportMeta) && names.contains(&self.atoms().bytes(name)));
        let free_name = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => Some(name),
            _ => None,
        };
        let (named, wanted): (Option<Atom>, &[u8]) = match hir[e].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                if !matches!(hir[right].kind, ExprKind::String(slash) if self.atoms().bytes(slash) == b"/")
                {
                    return false;
                }
                if is_import_meta(left, &[b"dirname", b"dir"]) {
                    return true;
                }
                (free_name(left), b"__dirname")
            }
            _ if is_import_meta(e, &[b"url", b"filename", b"path"]) => return true,
            _ => (free_name(e), b"__filename"),
        };
        let at = if let ExprKind::Binary { left, .. } = hir[e].kind {
            left
        } else {
            e
        };
        named.is_some_and(|name| {
            self.atoms().bytes(name) == wanted && self.is_commonjs_variable_ref(file, at, name)
        })
    }

    pub fn create_require_candidates(&mut self, file: FileId) -> &[Atom] {
        if !self
            .aot
            .commonjs
            .create_require_candidates
            .contains_key(&file)
        {
            let hir = self.hir(file);
            let may_resolve_own_path = |e: ExprId| match hir[e].kind {
                ExprKind::Dot { obj, .. } => matches!(hir[obj].kind, ExprKind::ImportMeta),
                ExprKind::Ident(name) => self.atoms().bytes(name) == b"__filename",
                ExprKind::Binary {
                    op: BinOp::Add,
                    right,
                    ..
                } => matches!(hir[right].kind, ExprKind::String(_)),
                _ => false,
            };
            let mut names = Vec::new();
            if self.atoms().lookup(b"createRequire").is_some() {
                for declaration in hir.var_decls.iter().filter(|declaration| {
                    matches!(
                        declaration.kind,
                        VarKind::Const | VarKind::Let | VarKind::Var
                    ) && declaration.init.is_some()
                }) {
                    if let (PatKind::Ident(name), ExprKind::Call(call)) =
                        (hir[declaration.pat].kind, hir[declaration.init].kind)
                        && hir[call].args.len() == 1
                        && may_resolve_own_path(hir.id_at(hir[call].args, 0))
                    {
                        names.push(name);
                    }
                }
            }
            self.aot
                .commonjs
                .create_require_candidates
                .insert(file, names);
        }
        &self.aot.commonjs.create_require_candidates[&file]
    }

    pub fn create_require_result_variables(&self, file: FileId) -> Vec<crate::bind::SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let may_resolve_own_path = |e: ExprId| match hir[e].kind {
            ExprKind::Dot { obj, .. } => matches!(hir[obj].kind, ExprKind::ImportMeta),
            ExprKind::Ident(name) => {
                let symbol = bound.expr_symbol[e.idx()];
                self.atoms().bytes(name) == b"__filename"
                    && (symbol.is_none()
                        || bound.symbols[symbol.idx()]
                            .decls
                            .iter()
                            .all(|&decl| matches!(decl, Decl::CommonJsVariable)))
            }
            ExprKind::Binary {
                op: BinOp::Add,
                right,
                ..
            } => matches!(hir[right].kind, ExprKind::String(_)),
            _ => false,
        };
        let declarations = hir.var_decls.iter().filter(|declaration| {
            declaration.init.is_some() && matches!(hir[declaration.pat].kind, PatKind::Ident(_))
        });
        declarations
            .filter(|declaration| matches!(hir[declaration.init].kind, ExprKind::Call(call) if hir[call].args.len() == 1 && may_resolve_own_path(hir.id_at(hir[call].args, 0))))
            .map(|declaration| bound.pat_symbol[declaration.pat.idx()])
            .collect()
    }

    pub fn is_create_require_for_own_file(
        &mut self,
        file: FileId,
        call: crate::hir::CallId,
    ) -> bool {
        let hir = self.hir(file);
        let Some(create_require) = self.atoms().lookup(b"createRequire") else {
            return false;
        };
        hir[call].args.len() == 1
            && self.is_builtin_module_member(file, hir[call].callee, b"module", create_require)
            && self.refers_to_own_file_path(file, hir.id_at(hir[call].args, 0))
    }

    pub fn is_own_file_require_ref(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else {
            return false;
        };
        if !self.create_require_candidates(file).contains(&name) {
            return false;
        }
        let Some(create_require) = self.atoms().lookup(b"createRequire") else {
            return false;
        };
        let Some(sym) = self.identifier_binding(file, e, name) else {
            return false;
        };
        let Some((of, init)) = self.initializer_of_constant(sym) else {
            return false;
        };
        if of != file {
            return false;
        }
        let ExprKind::Call(call) = hir[init].kind else {
            return false;
        };
        if hir[call].args.len() != 1
            || !self.is_builtin_module_member(file, hir[call].callee, b"module", create_require)
            || !self.refers_to_own_file_path(file, hir.id_at(hir[call].args, 0))
        {
            return false;
        }
        if self.files().export_symbol_of_value_symbol_if_exported(sym) != sym
            || hir.exports.iter().any(|export| {
                export.spec.is_none() && export.items.iter().any(|item| hir[item].local == name)
            })
        {
            return false;
        }
        for &mention in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
            if !matches!(hir[mention].kind, ExprKind::Ident(other) if other == name)
                || bound.expr_parent[mention.idx()] == Parent::None
                || bound.is_in_type_query(mention)
            {
                continue;
            }
            if self.identifier_binding(file, mention, name) != Some(sym) {
                continue;
            }
            let is_called_or_read = match bound.expr_parent[mention.idx()] {
                Parent::Expr(around) => match hir[around].kind {
                    ExprKind::Call(call) => hir[call].callee == mention,
                    ExprKind::Dot { obj, name, .. } => {
                        obj == mention && self.atoms().bytes(name) == b"resolve"
                    }
                    _ => false,
                },
                _ => false,
            };
            if !is_called_or_read {
                return false;
            }
        }
        true
    }

    fn require_call_specifier(&mut self, file: FileId, e: ExprId) -> Option<Atom> {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return None;
        };
        if let Some(specifier) = required_specifier(hir, e) {
            return self
                .is_commonjs_variable_ref(file, hir[call].callee, known::require)
                .then_some(specifier);
        }
        if hir[call].args.len() != 1 {
            return None;
        }
        let ExprKind::String(specifier) = hir[hir.id_at(hir[call].args, 0)].kind else {
            return None;
        };
        let callee = hir[call].callee;
        let is_own = match hir[callee].kind {
            ExprKind::Ident(known::require) => {
                self.is_commonjs_variable_ref(file, callee, known::require)
            }
            ExprKind::Dot {
                obj,
                name: known::require,
                chain: Chain::No,
                ..
            } if matches!(hir[obj].kind, ExprKind::Ident(known::module)) => {
                self.files().module(file).is_commonjs()
                    && self.is_commonjs_variable_ref(file, obj, known::module)
            }
            _ => false,
        };
        (is_own || self.is_own_file_require_ref(file, callee)).then_some(specifier)
    }

    fn is_commonjs_variable_ref(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(found) = self.identifier_binding(file, e, name) else {
            return true;
        };
        if name == known::require && found.file == file && self.is_own_file_require_ref(file, e) {
            return true;
        }
        if self
            .files()
            .flags(found)
            .intersects(SymFlags::MODULE_EXPORTS)
            || self
                .files()
                .decls_of(found)
                .iter()
                .copied()
                .any(|(_, decl)| matches!(decl, Decl::CommonJsVariable | Decl::File))
        {
            return true;
        }
        if found.file == file && self.files().flags(found).contains(SymFlags::ALIAS) {
            return false;
        }
        self.files()
            .value_declaration(found)
            .is_none_or(|(of, _)| !self.is_compiled(of))
            || self.is_declared_ambient(found)
    }

    fn is_initialized_once_evaluated(&mut self, file: FileId, graph: &Graph, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else {
            return false;
        };
        let Some((of, Decl::Var(pat))) = self
            .identifier_binding(file, e, name)
            .and_then(|sym| self.variable_declaration(sym))
        else {
            return false;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        of == file
            && hir[declaration].init.is_some()
            && self.runs(file, graph, hir[declaration].init) == Execution::Always
    }

    pub fn redeclared_commonjs_variable(&self, file: FileId, name: Atom) -> Option<Sym> {
        if !matches!(name, known::exports | known::module)
            || !self.files().module(file).is_commonjs()
        {
            return None;
        }
        let found =
            self.files()
                .resolve_name(file, crate::bind::ScopeId(0), name, SymFlags::VALUE)?;
        let is_var = found.file == file
            && self
                .files()
                .flags(found)
                .contains(SymFlags::FUNCTION_SCOPED_VARIABLE)
            && self
                .files()
                .decls_of(found)
                .iter()
                .copied()
                .all(|(_, decl)| matches!(decl, Decl::Var(_)));
        is_var.then_some(found)
    }

    fn runs(&self, file: FileId, graph: &Graph, e: ExprId) -> Execution {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut parent, mut runs, mut from, mut inner) = (
            bound.expr_parent[e.idx()],
            Execution::Always,
            StmtId::NONE,
            e,
        );
        let less = |runs: Execution| {
            if runs == Execution::Always {
                Execution::Sometimes
            } else {
                runs
            }
        };
        let is_falsy = |e: ExprId| {
            matches!(hir[e].kind, ExprKind::False | ExprKind::Null)
                || matches!(hir[e].kind, ExprKind::Number(number) if hir.numbers[number as usize] == 0.0)
        };
        loop {
            let within = std::mem::replace(&mut inner, ExprId::NONE);
            parent = match parent {
                Parent::Expr(outer) if outer.is_some() => {
                    if matches!(hir[outer].kind, ExprKind::Binary { op: BinOp::And, left, right } if right == within && is_falsy(left))
                    {
                        return Execution::Never;
                    }
                    inner = outer;
                    if !matches!(
                        hir[outer].kind,
                        ExprKind::Assign { op: None, .. }
                            | ExprKind::Binary {
                                op: BinOp::Comma,
                                ..
                            }
                    ) {
                        runs = less(runs);
                    }
                    from = StmtId::NONE;
                    bound.expr_parent[outer.idx()]
                }
                Parent::Stmt(stmt) if stmt.is_some() => {
                    match hir[stmt].kind {
                        StmtKind::Expr(_) | StmtKind::Block(_) | StmtKind::Var(_) => {}
                        StmtKind::If { yes, no, .. } if from.is_some() => {
                            match graph.folded.get(&(file, stmt)) {
                                Some(&is_true) if from == if is_true { no } else { yes } => {
                                    return Execution::Never;
                                }
                                Some(_) => {}
                                None => runs = less(runs),
                            }
                        }
                        StmtKind::If { .. } => {}
                        _ => runs = less(runs),
                    }
                    from = stmt;
                    bound.stmt_parent[stmt.idx()]
                }
                Parent::VarInit(_) => self.parent_of_node(file, parent),
                Parent::File => return runs,
                Parent::None | Parent::Expr(_) | Parent::Stmt(_) => return Execution::Never,
                _ => {
                    runs = if matches!(
                        parent,
                        Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_)
                    ) {
                        Execution::Later
                    } else {
                        less(runs)
                    };
                    from = StmtId::NONE;
                    self.parent_of_node(file, parent)
                }
            };
        }
    }

    fn single_store_variable_for(
        &self,
        file: FileId,
        graph: &Graph,
        value: ExprId,
    ) -> Option<(Atom, crate::bind::SymbolId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(assignment) = bound.expr_parent[value.idx()] else {
            return None;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value: stored,
        } = hir[assignment].kind
        else {
            return None;
        };
        let ExprKind::Ident(name) = hir[target].kind else {
            return None;
        };
        let is_statement = matches!(bound.expr_parent[assignment.idx()], Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::Expr(_)));
        if stored != value
            || !is_statement
            || self.runs(file, graph, assignment) != Execution::Always
        {
            return None;
        }
        let local = bound.expr_symbol[target.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        let &[Decl::Var(pat)] = &symbol.decls[..] else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let is_plain = hir[declaration].kind == VarKind::Var
            && hir[declaration].pat == pat
            && hir[declaration].init.is_none()
            && hir[declaration].ty.is_none()
            && !hir[declaration]
                .flags
                .intersects(Flags::EXPORT | Flags::AMBIENT)
            && !symbol.flags.contains(SymFlags::MERGED)
            && !self.has_direct_eval(file)
            && !self.is_stored_through_casts(file, local)
            && !hir.exports.iter().any(|export| {
                export.spec.is_none() && export.items.iter().any(|item| hir[item].local == name)
            });
        let is_left_out = |other: ExprId| matches!(bound.expr_parent[other.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { op: None, target, .. } if target == other) && self.runs(file, graph, around) == Execution::Never);
        (is_plain
            && bound
                .assignments_to(local)
                .iter()
                .all(|&(_, other)| other == target || is_left_out(other)))
        .then_some((name, local))
    }

    fn exports_use(&mut self, file: FileId, e: ExprId) -> Use {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } if obj == e => Use::Member(parent, name),
                ExprKind::Index {
                    obj,
                    index,
                    chain: Chain::No,
                } if obj == e => match string_literal_text(hir, index) {
                    name if name.is_some() => Use::Member(parent, name),
                    _ => Use::Other("a computed key"),
                },
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Void,
                    ..
                } => Use::Nothing,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    left,
                    ..
                } if left == e => Use::Nothing,
                ExprKind::Cond { test, .. } if test == e => Use::Nothing,
                ExprKind::Assign {
                    op: None, target, ..
                } if target == e => Use::Assigned(parent),
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == e && is_module_exports(hir, target) => Use::Exported,
                ExprKind::Call(_) if self.marks_as_es_module(file, parent, e) => {
                    Use::Marked(parent)
                }
                ExprKind::Call(call) if hir[call].callee == e => Use::Other("it is called"),
                ExprKind::Call(call) => {
                    if let Some((name, value)) = self.defined_getter(file, parent, e) {
                        return Use::Defined(parent, name, value);
                    }
                    if hir[call].args.len() == 2
                        && hir[call].chain == Chain::No
                        && self.is_export_star(file, hir[call].callee)
                    {
                        return if hir.id_at(hir[call].args, 0) == e {
                            Use::Starred(parent)
                        } else {
                            Use::StarredInto(parent)
                        };
                    }
                    if hir[call].args.len() == 1
                        && hir[call].chain == Chain::No
                        && matches!(hir[e].kind, ExprKind::Call(_))
                        && let Some(helper) = self.interop_helper(file, hir[call].callee)
                    {
                        return Use::Interop(parent, helper);
                    }
                    Use::Other(match hir[hir[call].callee].kind {
                        ExprKind::Dot {
                            obj,
                            name: known::defineProperty,
                            ..
                        } if matches!(hir[obj].kind, ExprKind::Ident(known::Object)) => {
                            "it is passed to Object.defineProperty, otherwise than for a marker or a getter"
                        }
                        ExprKind::Dot { obj, .. }
                            if matches!(hir[obj].kind, ExprKind::Ident(known::Object)) =>
                        {
                            "it is passed to another function of Object"
                        }
                        _ => "it is passed to a function",
                    })
                }
                ExprKind::Unary {
                    op: UnOp::Typeof, ..
                } => Use::Other("typeof"),
                ExprKind::Assign { .. } => Use::Other("it is assigned to something"),
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish | BinOp::And,
                    ..
                }
                | ExprKind::Cond { .. } => Use::Other("it is one of two values"),
                ExprKind::Binary { .. } => Use::Other("it is compared, or an operand"),
                ExprKind::New(_) => Use::Other("it is constructed, or passed to a constructor"),
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    Use::Other("an optional chain, or it is a key")
                }
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) => {
                    Use::Other("it is under an assertion")
                }
                ExprKind::Array(_) | ExprKind::Spread(_) => {
                    Use::Other("it is an element, or is spread")
                }
                ExprKind::Await(_) => Use::Other("it is awaited"),
                _ => Use::Other("it is used as a value"),
            },
            Parent::Stmt(stmt) => match hir[stmt].kind {
                StmtKind::Expr(_) => Use::Nothing,
                StmtKind::If { test, .. } if test == e => Use::Nothing,
                StmtKind::Return(_) => Use::Other("it is returned"),
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => {
                    Use::Other("it is exported")
                }
                _ => Use::Other("it is used as a value"),
            },
            Parent::VarInit(declaration) => Use::CopyCondition(declaration),
            Parent::Prop(_) => Use::Other("it is a property of a literal"),
            Parent::FnBody(_) => Use::Other("it is returned"),
            _ => Use::Other("it is used as a value"),
        }
    }

    fn marks_as_es_module(&mut self, file: FileId, call: ExprId, object: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return false;
        };
        let ExprKind::Dot {
            obj,
            name: known::defineProperty,
            chain: Chain::No,
            ..
        } = hir[hir[c].callee].kind
        else {
            return false;
        };
        let ExprKind::Ident(global @ known::Object) = hir[obj].kind else {
            return false;
        };
        if hir[c].args.len() != 3
            || hir[c].chain != Chain::No
            || hir.id_at(hir[c].args, 0) != object
            || !self.refers_to_global(file, obj, global)
        {
            return false;
        }
        let ExprKind::Object(props) = hir[hir.id_at(hir[c].args, 2)].kind else {
            return false;
        };
        let mut props = props.iter();
        let (Some(prop), None) = (props.next(), props.next()) else {
            return false;
        };
        let is_true = match hir[hir[prop].value].kind {
            ExprKind::True => true,
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => {
                matches!(hir[operand].kind, ExprKind::Number(number) if hir.numbers[number as usize] == 0.0)
            }
            _ => false,
        };
        string_literal_text(hir, hir.id_at(hir[c].args, 1)) == known::__esModule
            && hir[prop].kind == PropKind::Init
            && matches!(hir[prop].key, PropKey::Name(name) if self.atoms().bytes(name) == b"value")
            && is_true
    }

    fn defined_getter(
        &mut self,
        file: FileId,
        call: ExprId,
        object: ExprId,
    ) -> Option<(Atom, ExprId)> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return None;
        };
        let ExprKind::Dot {
            obj,
            name: known::defineProperty,
            chain: Chain::No,
            ..
        } = hir[hir[c].callee].kind
        else {
            return None;
        };
        let ExprKind::Ident(global @ known::Object) = hir[obj].kind else {
            return None;
        };
        if hir[c].args.len() != 3
            || hir[c].chain != Chain::No
            || hir.id_at(hir[c].args, 0) != object
            || !self.refers_to_global(file, obj, global)
        {
            return None;
        }
        let name = Some(string_literal_text(hir, hir.id_at(hir[c].args, 1)))
            .filter(|name| name.is_some())?;
        let ExprKind::Object(props) = hir[hir.id_at(hir[c].args, 2)].kind else {
            return None;
        };
        let (mut getter, mut is_enumerable) = (None, false);
        for prop in props.iter() {
            let value = hir[prop].value;
            match (hir[prop].kind, hir[prop].key) {
                (PropKind::Init, PropKey::Name(key))
                    if self.atoms().bytes(key) == b"enumerable" =>
                {
                    is_enumerable = match hir[value].kind {
                        ExprKind::True => true,
                        ExprKind::Unary {
                            op: UnOp::Not,
                            operand,
                        } => {
                            matches!(hir[operand].kind, ExprKind::Number(number) if hir.numbers[number as usize] == 0.0)
                        }
                        _ => false,
                    };
                }
                (PropKind::Init | PropKind::Method, PropKey::Name(known::get)) => {
                    match hir[value].kind {
                        ExprKind::Fn(func) => getter = Some(func),
                        _ => return None,
                    }
                }
                _ => return None,
            }
        }
        let func = getter.filter(|_| is_enumerable)?;
        if !hir[func].params.is_empty()
            || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            || hir[func].kind != FnKind::Arrow && self.uses_this(file, func)
        {
            return None;
        }
        match hir[func].body {
            FnBody::Expr(value) => Some((name, value)),
            FnBody::Block(stmts) if stmts.len() == 1 => match hir[hir.id_at(stmts, 0)].kind {
                StmtKind::Return(value) if value.is_some() => Some((name, value)),
                _ => None,
            },
            _ => None,
        }
    }

    fn interop_helper(&mut self, file: FileId, callee: ExprId) -> Option<Helper> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(_) = hir[callee].kind else {
            return None;
        };
        let local = bound.expr_symbol[callee.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.decls.len() != 1
            || symbol.flags.contains(SymFlags::MERGED)
            || !bound.assignments_to(local).is_empty()
            || self.is_stored_through_casts(file, local)
        {
            return None;
        }
        let func = match symbol.decls[0] {
            Decl::Fn(func) => func,
            Decl::Var(pat) => {
                let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
                    return None;
                };
                let init = hir[declaration].init.some()?;
                match hir[init].kind {
                    ExprKind::Fn(func) => func,
                    ExprKind::Binary {
                        op: BinOp::Or,
                        left,
                        right,
                    } => {
                        let ExprKind::Binary {
                            op: BinOp::And,
                            left: this,
                            right: own,
                        } = hir[left].kind
                        else {
                            return None;
                        };
                        let ExprKind::Dot {
                            obj,
                            chain: Chain::No,
                            ..
                        } = hir[own].kind
                        else {
                            return None;
                        };
                        let ExprKind::Fn(func) = hir[right].kind else {
                            return None;
                        };
                        let is_exports = |e: ExprId| {
                            matches!(hir[e].kind, ExprKind::This)
                                && self.this_container(file, e).is_none()
                                && self.enclosing_fn_of_expr(file, e).is_none()
                        };
                        if !is_exports(this)
                            || !is_exports(obj)
                            || !self.files().module(file).is_commonjs()
                            || hir[init].end > self.first_module_effect(file)
                        {
                            return None;
                        }
                        func
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        let mut params = hir[func].params.iter();
        let (Some(param), None) = (params.next(), params.next()) else {
            return None;
        };
        let (PatKind::Ident(_), FnBody::Block(stmts)) = (hir[hir[param].pat].kind, hir[func].body)
        else {
            return None;
        };
        let module = bound.pat_symbol[hir[param].pat.idx()];
        if hir[param].default.is_some()
            || !bound.assignments_to(module).is_empty()
            || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return None;
        }
        let is_module = |e: ExprId| {
            matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == module
        };
        let is_marked = |e: ExprId| match hir[e].kind {
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                is_module(left)
                    && matches!(hir[right].kind, ExprKind::Dot { obj, name: known::__esModule, chain: Chain::No, .. } if is_module(obj))
            }
            _ => false,
        };
        match hir[hir.ids(stmts).next()?].kind {
            StmtKind::Return(value) if value.is_some() => {
                let ExprKind::Cond { test, yes, no } = hir[value].kind else { return None };
                let ExprKind::Object(props) = hir[no].kind else { return None };
                let mut props = props.iter();
                let (Some(prop), None) = (props.next(), props.next()) else { return None };
                (is_marked(test) && is_module(yes) && hir[prop].kind == PropKind::Init && matches!(hir[prop].key, PropKey::Name(known::default)) && is_module(hir[prop].value)).then_some(Helper::Boxes)
            }
            StmtKind::If { test, yes, no } if no.is_none() && is_marked(test) => matches!(hir[yes].kind, StmtKind::Return(value) if value.is_some() && is_module(value)).then_some(Helper::Other),
            _ => None,
        }
    }

    fn initial_value_of(&self, file: FileId, named: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.expr_symbol[named.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        if !matches!(hir[named].kind, ExprKind::Ident(_))
            || symbol.decls.len() != 1
            || symbol.flags.contains(SymFlags::MERGED)
            || !bound.assignments_to(local).is_empty()
            || self.is_stored_through_casts(file, local)
        {
            return None;
        }
        let Decl::Var(pat) = symbol.decls[0] else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let init = hir[declaration].init.some()?;
        (matches!(hir[pat].kind, PatKind::Ident(_))
            && hir[declaration].loc.end <= self.first_module_effect(file)
            && self.enclosing_fn_of_expr(file, init).is_none())
        .then_some(init)
    }

    fn is_function_of_object(&mut self, file: FileId, e: ExprId, path: &[&[u8]]) -> bool {
        let hir = self.hir(file);
        let mut at = match hir[e].kind {
            ExprKind::Ident(_) => match self.initial_value_of(file, e) {
                Some(init) => init,
                None => return false,
            },
            _ => e,
        };
        for &wanted in path.iter().rev() {
            let ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } = hir[at].kind
            else {
                return false;
            };
            if self.atoms().bytes(name) != wanted {
                return false;
            }
            at = obj;
        }
        matches!(hir[at].kind, ExprKind::Ident(object @ known::Object) if self.refers_to_global(file, at, object))
    }

    fn value_unless_exported(&self, file: FileId, named: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::Binary {
            op: BinOp::Or,
            left,
            right,
        } = hir[self.initial_value_of(file, named)?].kind
        else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::And,
            left: this,
            right: own,
        } = hir[left].kind
        else {
            return None;
        };
        let ExprKind::Dot {
            obj,
            chain: Chain::No,
            ..
        } = hir[own].kind
        else {
            return None;
        };
        let is_exports = |e: ExprId| {
            matches!(hir[e].kind, ExprKind::This)
                && self.this_container(file, e).is_none()
                && self.enclosing_fn_of_expr(file, e).is_none()
        };
        (is_exports(this) && is_exports(obj) && self.files().module(file).is_commonjs())
            .then_some(right)
    }

    fn is_known_function(
        &mut self,
        file: FileId,
        named: ExprId,
        known: &'static KnownFunction,
        depth: u32,
    ) -> bool {
        let hir = self.hir(file);
        let function_at = |e: ExprId| match hir[e].kind {
            ExprKind::Fn(function) => Some(function),
            _ => None,
        };
        let function = match known.copy_condition {
            CopyCondition::UnlessExported => self
                .value_unless_exported(file, named)
                .and_then(function_at),
            CopyCondition::UnlessExportedWithObjectCreate(otherwise) => match self
                .value_unless_exported(file, named)
                .map(|value| hir[value].kind)
            {
                Some(ExprKind::Cond { test, yes, no })
                    if self.is_function_of_object(file, test, &[b"create"])
                        && function_at(no).is_some_and(|no| {
                            self.is_function_with_body(file, no, known.params, otherwise, depth)
                        }) =>
                {
                    function_at(yes)
                }
                _ => None,
            },
        };
        function.is_some_and(|function| {
            known
                .bodies
                .iter()
                .any(|body| self.is_function_with_body(file, function, known.params, body, depth))
        })
    }

    fn is_function_with_body(
        &mut self,
        file: FileId,
        function: FnId,
        params: usize,
        steps: &'static [Step],
        depth: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of = &hir[function];
        if depth > 4
            || !matches!(of.kind, FnKind::Arrow | FnKind::Expr)
            || of.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            || of.params.iter().len() != params
        {
            return false;
        }
        let mut locals = [crate::bind::SymbolId::NONE; KNOWN_FUNCTION_LOCALS];
        for (number, param) in of.params.iter().enumerate() {
            if !matches!(hir[hir[param].pat].kind, PatKind::Ident(_))
                || hir[param].default.is_some()
                || hir[param].flags.contains(Flags::REST)
            {
                return false;
            }
            locals[number] = bound.pat_symbol[hir[param].pat.idx()];
        }
        match of.body {
            FnBody::Block(stmts) => {
                let stmts: Vec<StmtId> = hir.ids(stmts).collect();
                stmts.len() == steps.len()
                    && stmts.iter().zip(steps).all(|(&stmt, step)| {
                        self.matches_step(file, stmt, step, &mut locals, depth)
                    })
            }
            FnBody::Expr(_) | FnBody::None => false,
        }
    }

    fn matches_step(
        &mut self,
        file: FileId,
        stmt: StmtId,
        step: &Step,
        locals: &mut [crate::bind::SymbolId; KNOWN_FUNCTION_LOCALS],
        depth: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut stmt = stmt;
        while let StmtKind::Block(inner) = hir[stmt].kind {
            let mut inner = hir.ids(inner);
            let (Some(only), None) = (inner.next(), inner.next()) else {
                return false;
            };
            stmt = only;
        }
        let declared_by = |left: StmtId| {
            let StmtKind::Var(declarations) = hir[left].kind else {
                return None;
            };
            let mut declarations = declarations.iter();
            let (Some(one), None) = (declarations.next(), declarations.next()) else {
                return None;
            };
            let is_plain =
                hir[one].init.is_none() && matches!(hir[hir[one].pat].kind, PatKind::Ident(_));
            is_plain.then(|| bound.pat_symbol[hir[one].pat.idx()])
        };
        match (*step, hir[stmt].kind) {
            (
                Step::ForIn(number, of, body),
                StmtKind::ForIn {
                    left,
                    expr,
                    body: run,
                },
            ) => {
                let Some(variable) = declared_by(left) else {
                    return false;
                };
                locals[number] = variable;
                self.matches_tree(file, expr, &of, locals, depth)
                    && self.matches_step(file, run, body, locals, depth)
            }
            (
                Step::If(test, then),
                StmtKind::If {
                    test: tested,
                    yes,
                    no,
                },
            ) => {
                no.is_none()
                    && self.matches_tree(file, tested, &test, locals, depth)
                    && self.matches_step(file, yes, then, locals, depth)
            }
            (Step::If(test, &Step::Do(then)), StmtKind::Expr(e)) => match hir[e].kind {
                ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    right,
                } => {
                    self.matches_tree(file, left, &test, locals, depth)
                        && self.matches_tree(file, right, &then, locals, depth)
                }
                _ => false,
            },
            (Step::Declare(number, value), StmtKind::Var(declarations)) => {
                let mut declarations = declarations.iter();
                let (Some(one), None) = (declarations.next(), declarations.next()) else {
                    return false;
                };
                if hir[one].init.is_none() || !matches!(hir[hir[one].pat].kind, PatKind::Ident(_)) {
                    return false;
                }
                locals[number] = bound.pat_symbol[hir[one].pat.idx()];
                self.matches_tree(file, hir[one].init, &value, locals, depth)
            }
            (Step::Do(tree), StmtKind::Expr(e)) => self.matches_tree(file, e, &tree, locals, depth),
            _ => false,
        }
    }

    fn matches_tree(
        &mut self,
        file: FileId,
        e: ExprId,
        tree: &Tree,
        locals: &mut [crate::bind::SymbolId; KNOWN_FUNCTION_LOCALS],
        depth: u32,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_local = |e: ExprId, local: crate::bind::SymbolId| {
            matches!(hir[e].kind, ExprKind::Ident(_))
                && local.is_some()
                && bound.expr_symbol[e.idx()] == local
        };
        match (*tree, hir[e].kind) {
            (Tree::Local(number), _) => is_local(e, locals[number]),
            (Tree::ObjectStatic(path), _) => self.is_function_of_object(file, e, path),
            (Tree::Known(known), _) => self.is_known_function(file, e, known, depth + 1),
            (Tree::Call(callee, args), ExprKind::Call(call)) => {
                let given: Vec<ExprId> = hir.ids(hir[call].args).collect();
                hir[call].chain == Chain::No && given.len() == args.len() && self.matches_tree(file, hir[call].callee, callee, locals, depth) && given.iter().zip(args).all(|(&given, arg)| self.matches_tree(file, given, arg, locals, depth))
            }
            (Tree::Member(of, wanted), ExprKind::Dot { obj, name, chain: Chain::No, .. }) => self.atoms().bytes(name) == wanted && self.matches_tree(file, obj, of, locals, depth),
            (Tree::Element(of, key), ExprKind::Index { obj, index, chain: Chain::No }) => self.matches_tree(file, obj, of, locals, depth) && self.matches_tree(file, index, key, locals, depth),
            (Tree::Literal(wanted), ExprKind::Object(props)) => {
                props.iter().len() == wanted.len()
                    && wanted.iter().all(|(name, value)| {
                        let found = props.iter().find(|&prop| hir[prop].kind == PropKind::Init && matches!(hir[prop].key, PropKey::Name(key) if self.atoms().bytes(key) == *name));
                        found.is_some_and(|prop| self.matches_tree(file, hir[prop].value, value, locals, depth))
                    })
            }
            (Tree::Getter(returned), ExprKind::Fn(getter)) => {
                let of = &hir[getter];
                let value = match of.body {
                    FnBody::Expr(value) if of.kind == FnKind::Arrow => Some(value),
                    FnBody::Block(stmts) if matches!(of.kind, FnKind::Arrow | FnKind::Expr) => {
                        let mut stmts = hir.ids(stmts);
                        match (stmts.next().map(|stmt: StmtId| hir[stmt].kind), stmts.next()) {
                            (Some(StmtKind::Return(value)), None) => value.some(),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                of.params.is_empty() && !of.flags.intersects(Flags::ASYNC | Flags::GENERATOR) && value.is_some_and(|value| self.matches_tree(file, value, returned, locals, depth))
            }
            (Tree::Text(wanted), ExprKind::String(text)) => self.atoms().bytes(text) == wanted,
            (Tree::True, ExprKind::True) => true,
            (Tree::True, ExprKind::Unary { op: UnOp::Not, operand }) => matches!(hir[operand].kind, ExprKind::Number(index) if hir.numbers[index as usize] == 0.0),
            (Tree::Not(inner), ExprKind::Unary { op: UnOp::Not, operand }) => self.matches_tree(file, operand, inner, locals, depth),
            (Tree::And(first, second), ExprKind::Binary { op: BinOp::And, left, right })
            | (Tree::Or(first, second), ExprKind::Binary { op: BinOp::Or, left, right })
            | (Tree::Differs(first, second), ExprKind::Binary { op: BinOp::NotEqEq, left, right })
            | (Tree::Same(first, second), ExprKind::Binary { op: BinOp::EqEqEq, left, right })
            | (Tree::Store(first, second), ExprKind::Assign { op: None, target: left, value: right }) => self.matches_tree(file, left, first, locals, depth) && self.matches_tree(file, right, second, locals, depth),
            (Tree::Undefined, ExprKind::Ident(name @ known::undefined)) => self.refers_to_global(file, e, name),
            (Tree::Undefined, ExprKind::Unary { op: UnOp::Void, operand }) => matches!(hir[operand].kind, ExprKind::Number(_)),
            (Tree::Has(wanted, of), ExprKind::Binary { op: BinOp::In, left, right }) => matches!(hir[left].kind, ExprKind::String(text) if self.atoms().bytes(text) == wanted) && self.matches_tree(file, right, of, locals, depth),
            (Tree::Choice(asked, first, second), ExprKind::Cond { test, yes, no }) => self.matches_tree(file, test, asked, locals, depth) && self.matches_tree(file, yes, first, locals, depth) && self.matches_tree(file, no, second, locals, depth),
            (Tree::Either(first, second), _) => self.matches_tree(file, e, first, locals, depth) || self.matches_tree(file, e, second, locals, depth),
            _ => false,
        }
    }

    fn is_export_star(&mut self, file: FileId, callee: ExprId) -> bool {
        self.is_known_function(file, callee, &EXPORT_STAR_HELPER, 0)
    }

    fn is_pure_in_prologue(&mut self, file: FileId, e: ExprId, depth: u32) -> bool {
        let hir = self.hir(file);
        if depth > 32 {
            return false;
        }
        match hir[e].kind {
            ExprKind::Fn(_)
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex => true,
            ExprKind::Unary {
                op: UnOp::Void | UnOp::Not | UnOp::Typeof,
                operand,
            } => self.is_pure_in_prologue(file, operand, depth + 1),
            ExprKind::Binary {
                op:
                    BinOp::And
                    | BinOp::Or
                    | BinOp::Nullish
                    | BinOp::Comma
                    | BinOp::EqEqEq
                    | BinOp::NotEqEq,
                left,
                right,
            } => {
                self.is_pure_in_prologue(file, left, depth + 1)
                    && self.is_pure_in_prologue(file, right, depth + 1)
            }
            ExprKind::Cond { test, yes, no } => [test, yes, no]
                .into_iter()
                .all(|part| self.is_pure_in_prologue(file, part, depth + 1)),
            ExprKind::Call(call) if required_specifier(hir, e).is_some() => {
                self.is_commonjs_variable_ref(file, hir[call].callee, known::require)
            }
            ExprKind::Call(call) => {
                let is_literal = |e: ExprId| {
                    matches!(
                        hir[e].kind,
                        ExprKind::Null
                            | ExprKind::True
                            | ExprKind::False
                            | ExprKind::Number(_)
                            | ExprKind::String(_)
                    )
                };
                let callee = hir[call].callee;
                let (is_helper, is_required) = (
                    self.interop_helper(file, callee).is_some()
                        || self.is_export_star(file, callee),
                    self.is_read_from_required(file, callee, depth + 1),
                );
                let defines = matches!(hir[callee].kind, ExprKind::Dot { obj, name: known::defineProperty, chain: Chain::No, .. } if matches!(hir[obj].kind, ExprKind::Ident(global @ known::Object) if self.refers_to_global(file, obj, global)));
                let args: Vec<ExprId> = hir.ids(hir[call].args).collect();
                if is_helper {
                    args.into_iter()
                        .all(|arg| self.is_pure_in_prologue(file, arg, depth + 1))
                } else if defines {
                    args.len() == 3
                        && (matches!(hir[args[0]].kind, ExprKind::Ident(known::exports))
                            || is_module_exports(hir, args[0]))
                        && is_literal(args[1])
                        && self.is_pure_in_prologue(file, args[2], depth + 1)
                } else {
                    (is_required || self.creates_symbols(file, callee))
                        && args.into_iter().all(is_literal)
                }
            }
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            } if matches!(hir[obj].kind, ExprKind::Ident(name @ known::Object) if self.refers_to_global(file, obj, name)) => {
                true
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.is_read_from_required(file, e, depth + 1)
                    || self.is_own_export(file, e) && !self.has_defined_getter(file, e)
            }
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                (matches!(hir[target].kind, ExprKind::Ident(_))
                    && self.bound(file).expr_symbol[target.idx()].is_some()
                    || self.is_own_export(file, target))
                    && self.is_pure_in_prologue(file, value, depth + 1)
            }
            ExprKind::Object(props) => props.iter().all(|prop| {
                matches!(
                    hir[prop].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && matches!(hir[prop].key, PropKey::Name(_))
                    && self.is_pure_in_prologue(file, hir[prop].value, depth + 1)
            }),
            _ => false,
        }
    }

    fn creates_symbols(&mut self, file: FileId, callee: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[callee].kind {
            ExprKind::Ident(name @ known::Symbol) => self.refers_to_global(file, callee, name),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                self.atoms().bytes(name) == b"for"
                    && matches!(hir[obj].kind, ExprKind::Ident(global @ known::Symbol) if self.refers_to_global(file, obj, global))
            }
            _ => false,
        }
    }

    fn only_creates_values_expr(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: &[crate::bind::SymbolId],
        depth: u32,
    ) -> bool {
        let hir = self.hir(file);
        if depth > 32 {
            return false;
        }
        match hir[e].kind {
            ExprKind::Fn(_)
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_) => true,
            ExprKind::Ident(_) => declared.contains(&self.bound(file).expr_symbol[e.idx()]),
            ExprKind::Call(call) => {
                hir[call].chain == Chain::No
                    && hir
                        .ids(hir[call].args)
                        .all(|argument: ExprId| matches!(hir[argument].kind, ExprKind::String(_)))
                    && self.creates_symbols(file, hir[call].callee)
            }
            ExprKind::Object(props) => props.iter().all(|prop| {
                matches!(
                    hir[prop].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                ) && matches!(hir[prop].key, PropKey::Name(_))
                    && self.only_creates_values_expr(file, hir[prop].value, declared, depth + 1)
            }),
            _ => false,
        }
    }

    fn module_only_creates_values(&mut self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut declared: Vec<crate::bind::SymbolId> = hir
            .ids(hir.body)
            .filter_map(|stmt: StmtId| {
                if let StmtKind::Fn(function) = hir[stmt].kind {
                    Some(bound.fn_symbol[function.idx()])
                } else {
                    None
                }
            })
            .filter(|symbol| symbol.is_some())
            .collect();
        hir.ids(hir.body).all(|stmt: StmtId| match hir[stmt].kind {
            StmtKind::Empty | StmtKind::Fn(_) => true,
            StmtKind::Expr(e) => match hir[e].kind {
                ExprKind::String(_) => true,
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => {
                    is_module_exports(hir, target)
                        && self.only_creates_values_expr(file, value, &declared, 0)
                }
                _ => false,
            },
            StmtKind::Var(declarations) => declarations.iter().all(|declaration| {
                let is_plain = matches!(
                    hir[declaration].kind,
                    VarKind::Var | VarKind::Let | VarKind::Const
                ) && matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_));
                let is_sound = is_plain
                    && (hir[declaration].init.is_none()
                        || self.only_creates_values_expr(
                            file,
                            hir[declaration].init,
                            &declared,
                            0,
                        ));
                declared.push(bound.pat_symbol[hir[declaration].pat.idx()]);
                is_sound
            }),
            _ => false,
        })
    }

    fn is_own_export(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot {
            obj,
            chain: Chain::No,
            ..
        } = hir[e].kind
        else {
            return false;
        };
        match hir[obj].kind {
            ExprKind::Ident(name @ known::exports) => {
                self.is_commonjs_variable_ref(file, obj, name)
            }
            ExprKind::This => true,
            _ => is_module_exports(hir, obj),
        }
    }

    fn has_defined_getter(&self, file: FileId, member: ExprId) -> bool {
        let (hir, by_kind) = (self.hir(file), self.file_exprs_by_kind(file));
        let ExprKind::Dot { name, .. } = hir[member].kind else {
            return true;
        };
        by_kind.of(ExprTag::Call).iter().any(|&e| {
            let ExprKind::Call(call) = hir[e].kind else { return false };
            if !matches!(hir[hir[call].callee].kind, ExprKind::Dot { name: known::defineProperty, .. }) || hir[call].args.len() != 3 || self.enclosing_fn_of_expr(file, e).is_some() {
                return false;
            }
            let key = string_literal_text(hir, hir.id_at(hir[call].args, 1));
            let has_no_getter = matches!(hir[hir.id_at(hir[call].args, 2)].kind, ExprKind::Object(props) if props.iter().all(|prop| matches!(hir[prop].kind, PropKind::Init) && !matches!(hir[prop].key, PropKey::Name(known::get) | PropKey::Computed(_))));
            (key.is_none() || key == name) && !has_no_getter
        })
    }

    fn is_read_from_required(&mut self, file: FileId, e: ExprId, depth: u32) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            } if depth < 32 => self.is_read_from_required(file, obj, depth + 1),
            ExprKind::Call(call) => {
                required_specifier(hir, e).is_some()
                    && self.is_commonjs_variable_ref(file, hir[call].callee, known::require)
            }
            _ => false,
        }
    }

    fn prologue_end(&mut self, file: FileId, graph: &Graph) -> u32 {
        let hir = self.hir(file);
        let mut end = 0;
        for stmt in hir.ids(hir.body) {
            let is_pure_expr = match hir[stmt].kind {
                StmtKind::Empty | StmtKind::Fn(_) => true,
                StmtKind::Expr(e) => self.is_pure_in_prologue(file, e, 0),
                StmtKind::Var(declarations) => declarations.iter().all(|declaration| {
                    let is_plain = match hir[hir[declaration].pat].kind {
                        PatKind::Ident(_) => true,
                        PatKind::Object(props) => props.iter().all(|prop| {
                            !hir[prop].is_rest
                                && hir[prop].default.is_none()
                                && matches!(hir[prop].key, PropKey::Name(_) | PropKey::None)
                                && matches!(hir[hir[prop].value].kind, PatKind::Ident(_))
                        }),
                        _ => false,
                    };
                    is_plain
                        && (hir[declaration].init.is_none()
                            || self.is_pure_in_prologue(file, hir[declaration].init, 0))
                }),
                _ => false,
            };
            if !is_pure_expr || graph.folded.contains_key(&(file, stmt)) {
                break;
            }
            end = hir[stmt].loc.end;
        }
        end
    }

    fn first_module_effect(&self, file: FileId) -> u32 {
        let (hir, by_kind) = (self.hir(file), self.file_exprs_by_kind(file));
        let tags = [
            ExprTag::Call,
            ExprTag::New,
            ExprTag::TaggedTemplate,
            ExprTag::Assign,
            ExprTag::Unary,
            ExprTag::ImportCall,
            ExprTag::Await,
            ExprTag::Yield,
        ];
        let has_effect = |e: ExprId| {
            !matches!(
                hir[e].kind,
                ExprKind::Unary {
                    op: UnOp::Plus
                        | UnOp::Minus
                        | UnOp::BitNot
                        | UnOp::Not
                        | UnOp::Typeof
                        | UnOp::Void,
                    ..
                }
            )
        };
        let bound = self.bound(file);
        let is_body_loop = |stmt: &StmtId| {
            matches!(
                hir[*stmt].kind,
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
            ) && self
                .enclosing_fn(file, bound.stmt_parent[stmt.idx()])
                .is_none()
        };
        let first_loop = (0..hir.stmts.len() as u32)
            .map(StmtId)
            .filter(is_body_loop)
            .map(|stmt| hir[stmt].start)
            .min()
            .unwrap_or(u32::MAX);
        tags.iter()
            .flat_map(|&tag| by_kind.of(tag))
            .filter(|&&e| has_effect(e) && self.enclosing_fn_of_expr(file, e).is_none())
            .map(|&e| hir[e].pos)
            .min()
            .unwrap_or(u32::MAX)
            .min(first_loop)
    }

    fn member_use(&self, file: FileId, member: ExprId) -> MemberUse {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut asserted = member;
        while let Parent::Expr(parent) = bound.expr_parent[asserted.idx()]
            && matches!(
                hir[parent].kind,
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_)
            )
        {
            asserted = parent;
        }
        if let Parent::Expr(parent) = bound.expr_parent[asserted.idx()] {
            match hir[parent].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if target == asserted && bound.get_assignment_target(hir, parent).is_none() => {
                    return MemberUse::Store(value);
                }
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => return MemberUse::Delete,
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call)
                    if hir[call].callee == asserted =>
                {
                    return MemberUse::Call;
                }
                _ => {}
            }
        }
        if bound.get_assignment_target(hir, asserted).is_some() {
            MemberUse::OtherStore
        } else {
            MemberUse::Read
        }
    }

    fn is_object_prototype_name(&self, name: Atom) -> bool {
        OBJECT_PROTOTYPE_NAMES.contains(&self.atoms().bytes(name))
    }

    fn ignores_this(
        &mut self,
        file: FileId,
        value: ExprId,
        depth: u32,
        named_by: &dyn Fn(FileId, ExprId) -> Option<(FileId, Vec<ExprId>)>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if depth > 16 {
            return false;
        }
        match hir[value].kind {
            ExprKind::Fn(func) => hir[func].kind == FnKind::Arrow || !self.uses_this(file, func),
            ExprKind::Class(_)
            | ExprKind::Unary { op: UnOp::Void, .. }
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Assign {
                op: None, value, ..
            } => self.ignores_this(file, value, depth + 1, named_by),
            ExprKind::Ident(_) => {
                let local = bound.expr_symbol[value.idx()];
                let Some(symbol) = bound.symbols.get(local.idx()) else {
                    return false;
                };
                if !bound.assignments_to(local).is_empty()
                    || symbol.flags.contains(SymFlags::MERGED)
                    || self.is_stored_through_casts(file, local)
                {
                    return false;
                }
                match symbol.decls[..] {
                    [Decl::Fn(func)] => !self.uses_this(file, func),
                    [Decl::Class(_)] => true,
                    [Decl::Var(pat)] => {
                        matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if hir[declaration].init.is_some() && self.ignores_this(file, hir[declaration].init, depth + 1, named_by))
                    }
                    _ => false,
                }
            }
            ExprKind::Dot { .. } => named_by(file, value).is_some_and(|(of, values)| {
                values.into_iter().all(|value| {
                    value.is_some() && self.ignores_this(of, value, depth + 1, named_by)
                })
            }),
            _ => false,
        }
    }

    fn literal_with_single_name(
        &mut self,
        file: FileId,
        assignment: ExprId,
        name_of_literal: ExprId,
    ) -> Option<ExprId> {
        let (hir, bound, by_kind) = (
            self.hir(file),
            self.bound(file),
            self.file_exprs_by_kind(file),
        );
        let ExprKind::Ident(name) = hir[name_of_literal].kind else {
            return None;
        };
        let local = bound.expr_symbol[name_of_literal.idx()];
        let symbol = bound
            .symbols
            .get(local.idx())
            .filter(|symbol| !symbol.flags.contains(SymFlags::MERGED))?;
        let &[Decl::Var(pat)] = &symbol.decls[..] else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let literal = hir[declaration].init;
        let is_plain = matches!(hir[pat].kind, PatKind::Ident(_))
            && literal.is_some()
            && matches!(hir[literal].kind, ExprKind::Object(_))
            && hir[declaration].ty.is_none()
            && !hir[declaration]
                .flags
                .intersects(Flags::EXPORT | Flags::AMBIENT)
            && bound.assignments_to(local).is_empty()
            && !self.is_stored_through_casts(file, local);
        let Parent::Stmt(assigning) = bound.expr_parent[assignment.idx()] else {
            return None;
        };
        let declaring = bound.var_stmt[declaration.idx()];
        if !is_plain
            || declaring.is_none()
            || !matches!(hir[declaring].kind, StmtKind::Var(declarations) if declarations.len() == 1)
        {
            return None;
        }
        let statements: Vec<StmtId> = hir.ids(hir.body).collect();
        if !statements
            .iter()
            .zip(statements.iter().skip(1))
            .any(|(&first, &second)| first == declaring && second == assigning)
        {
            return None;
        }
        let holder = self.files().sym(file, local);
        let mut mentions = 0;
        for &reference in by_kind.of(ExprTag::Ident) {
            if matches!(hir[reference].kind, ExprKind::Ident(named) if named == name)
                && bound.expr_parent[reference.idx()] != Parent::None
                && self.identifier_binding(file, reference, name) == Some(holder)
            {
                mentions += 1;
            }
        }
        (mentions == 1).then_some(literal)
    }

    fn find_commonjs_module(&mut self, file: FileId, graph: &Graph) -> Module {
        let (hir, bound, by_kind) = (
            self.hir(file),
            self.bound(file),
            self.file_exprs_by_kind(file),
        );
        let mut module = Module {
            obstacle: None,
            module_object_reason: None,
            values: Vec::new(),
            unconditional_value_stores: 0,
            is_redirect: false,
            re_exports: None,
            mentions: Vec::new(),
            stores: FxHashMap::default(),
            methods: Vec::new(),
            marker: ExprId::NONE,
            getters: FxHashMap::default(),
            literal: ExprId::NONE,
            name_of_literal: ExprId::NONE,
            reads: FxHashSet::default(),
            stars: Vec::new(),
            is_exact_outside_cycles: false,
        };
        if graph.entry_points.contains(&file) {
            module.obstacle = Some("it is an entry point: the host hands out what it exports");
        }
        if self.has_direct_eval(file) {
            module.obstacle = Some("eval");
            module.module_object_reason = module.obstacle;
        }
        if self
            .redeclared_commonjs_variable(file, known::exports)
            .is_some()
        {
            module.obstacle = Some("`exports` is declared again");
        }
        if self
            .redeclared_commonjs_variable(file, known::module)
            .is_some()
        {
            module.obstacle = Some("`module` is declared again");
            module.module_object_reason = module.obstacle;
        }
        if !hir.with_bodies.is_empty() {
            module.obstacle = Some("with");
            module.module_object_reason = module.obstacle;
        }
        if (0..hir.stmts.len() as u32).map(StmtId).any(|stmt| {
            matches!(hir[stmt].kind, StmtKind::Return(_))
                && self
                    .enclosing_fn(file, bound.stmt_parent[stmt.idx()])
                    .is_none()
        }) {
            module.obstacle = Some("return at the top level");
        }
        for &e in by_kind.of(ExprTag::Ident) {
            let ExprKind::Ident(name) = hir[e].kind else {
                continue;
            };
            if name == known::arguments
                && !bound.is_arguments_object(e)
                && bound.expr_symbol[e.idx()].is_none()
            {
                module.obstacle = Some("`arguments` at the top level");
                module.module_object_reason = module.obstacle;
            }
            if name != known::exports && name != known::module
                || !self.is_commonjs_variable_ref(file, e, name)
                || self.runs(file, graph, e) == Execution::Never
            {
                continue;
            }
            match bound.expr_parent[e.idx()] {
                _ if name == known::exports => module.mentions.push(e),
                Parent::Expr(parent) if is_module_exports_inside_parentheses(hir, parent) => {
                    module.mentions.push(parent)
                }
                _ => {
                    module.obstacle = Some("`module` is more than module.exports");
                    module.module_object_reason = module.obstacle;
                }
            }
        }
        for &e in by_kind.of(ExprTag::This) {
            if self.this_container(file, e).is_none()
                && self.runs(file, graph, e) != Execution::Never
                && !hir.references_import_meta()
            {
                module.mentions.push(e);
            }
        }
        let mut next = 0;
        while next < module.mentions.len() {
            let e = module.mentions[next];
            next += 1;
            if !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) {
                match bound.expr_parent[e.idx()] {
                    Parent::Expr(parent)
                        if matches!(hir[parent].kind, ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == e)
                            || matches!(
                                hir[parent].kind,
                                ExprKind::Unary {
                                    op: UnOp::Delete,
                                    ..
                                }
                            ) =>
                    {
                        module.module_object_reason = Some("module.exports is called or deleted");
                    }
                    Parent::Expr(parent)
                        if matches!(
                            hir[parent].kind,
                            ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_)
                        ) =>
                    {
                        module.module_object_reason = Some("module.exports is called or deleted")
                    }
                    Parent::Expr(parent)
                        if matches!(hir[parent].kind, ExprKind::Assign { op: None, target, .. } if target == e)
                            && bound.get_assignment_target(hir, parent).is_none() =>
                    {
                        if let ExprKind::Assign { value, .. } = hir[parent].kind {
                            module.values.push(value);
                            module.unconditional_value_stores +=
                                (self.runs(file, graph, parent) == Execution::Always) as u32;
                        }
                    }
                    _ if bound.get_assignment_target(hir, e).is_some() => {
                        module.values.push(ExprId::NONE)
                    }
                    _ => {}
                }
            }
            match self.exports_use(file, e) {
                Use::Member(member, name) => {
                    if self.is_object_prototype_name(name) {
                        module.obstacle = Some("a name of Object.prototype");
                    }
                    let value = match self.member_use(file, member) {
                        MemberUse::Read => {
                            module.reads.insert(name);
                            continue;
                        }
                        MemberUse::Call => {
                            module.reads.insert(name);
                            module.methods.push(name);
                            continue;
                        }
                        MemberUse::Delete => {
                            module.obstacle = Some("delete exports.name");
                            continue;
                        }
                        MemberUse::Store(value) => value,
                        MemberUse::OtherStore => ExprId::NONE,
                    };
                    let runs = self.runs(file, graph, member);
                    module
                        .stores
                        .entry(name)
                        .or_default()
                        .push(Store { value, runs });
                }
                Use::Nothing => {}
                Use::Marked(call)
                    if self.runs(file, graph, call) == Execution::Always
                        && !module.is_marked()
                        && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_)) =>
                {
                    module.marker = call;
                    module
                        .stores
                        .entry(known::__esModule)
                        .or_default()
                        .push(Store {
                            value: ExprId::NONE,
                            runs: Execution::Always,
                        });
                }
                Use::Marked(_) => module.obstacle = Some("__esModule is defined late, or twice"),
                Use::Assigned(assignment) => {
                    let ExprKind::Assign { value, .. } = hir[assignment].kind else {
                        continue;
                    };
                    let other = required_specifier(hir, value)
                        .and_then(|specifier| graph.required(file, specifier));
                    let is_statement =
                        matches!(bound.expr_parent[assignment.idx()], Parent::Stmt(_));
                    let is_whole = is_statement
                        && !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This)
                        && self.runs(file, graph, assignment) == Execution::Always;
                    let named_literal = if is_whole && other.is_none() && module.literal.is_none() {
                        self.literal_with_single_name(file, assignment, value)
                    } else {
                        None
                    };
                    match other {
                        Some(other) if is_whole => {
                            module.re_exports = Some(other);
                            module.is_redirect = hir.ids(hir.body).count() == 1;
                        }
                        None if is_whole
                            && matches!(hir[value].kind, ExprKind::Object(_))
                            && module.literal.is_none() =>
                        {
                            module.literal = value
                        }
                        None if named_literal.is_some() => {
                            (module.literal, module.name_of_literal) =
                                (named_literal.unwrap_or(ExprId::NONE), value)
                        }
                        _ if matches!(hir[e].kind, ExprKind::Ident(_)) => {
                            module.obstacle = Some("exports = ..")
                        }
                        _ if !is_whole => {
                            module.obstacle =
                                Some("module.exports = .. in a function, a branch or an expression")
                        }
                        _ => {
                            module.obstacle = Some(match hir[value].kind {
                                ExprKind::Fn(_) => "module.exports = a function",
                                ExprKind::Class(_) => "module.exports = a class",
                                ExprKind::Ident(_) => match bound
                                    .symbols
                                    .get(bound.expr_symbol[value.idx()].idx())
                                    .map(|symbol| &symbol.decls[..])
                                {
                                    Some([Decl::Fn(_)]) => {
                                        "module.exports = the name of a function"
                                    }
                                    Some([Decl::Class(_)]) => {
                                        "module.exports = the name of a class"
                                    }
                                    Some(&[Decl::Var(pat)]) => match bound.pat_parent[pat.idx()] {
                                        PatParent::Var(declaration)
                                            if hir[declaration].init.is_some() =>
                                        {
                                            match hir[hir[declaration].init].kind {
                                                ExprKind::Object(_) => {
                                                    "module.exports = the name of a variable that holds { .. }"
                                                }
                                                ExprKind::Fn(_) => {
                                                    "module.exports = the name of a variable that holds a function"
                                                }
                                                ExprKind::Class(_) => {
                                                    "module.exports = the name of a variable that holds a class"
                                                }
                                                ExprKind::Call(_) | ExprKind::New(_) => {
                                                    "module.exports = the name of a variable that holds the result of a call"
                                                }
                                                _ => {
                                                    "module.exports = the name of a variable that holds something else"
                                                }
                                            }
                                        }
                                        _ => {
                                            "module.exports = the name of a variable without an initializer, or of a pattern"
                                        }
                                    },
                                    _ => "module.exports = another name",
                                },
                                ExprKind::Call(_) if other.is_some() => {
                                    "module.exports = require(..), twice"
                                }
                                ExprKind::Call(_) if required_specifier(hir, value).is_some() => {
                                    "module.exports = require(..) of a module that is not compiled"
                                }
                                ExprKind::Call(_) => "module.exports = the result of a call",
                                ExprKind::New(_) => "module.exports = new ..",
                                ExprKind::Object(_) => "module.exports = { .. }, twice",
                                ExprKind::Assign { .. } => "module.exports = .. = ..",
                                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                                    if module.mentions.contains(&obj) =>
                                {
                                    "module.exports = exports.name"
                                }
                                ExprKind::Dot { obj, .. }
                                    if required_specifier(hir, obj).is_some() =>
                                {
                                    "module.exports = require(..).name"
                                }
                                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                                    "module.exports = a property of something"
                                }
                                _ => "module.exports = another expression",
                            })
                        }
                    }
                }
                Use::StarredInto(call) => {
                    if self.runs(file, graph, call) == Execution::Always
                        && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_))
                    {
                        module.stars.push(call);
                        module.is_exact_outside_cycles = true;
                    } else {
                        module.obstacle = Some("__exportStar is called late");
                    }
                }
                Use::Starred(_) => module.obstacle = Some("it is passed to a function"),
                Use::Defined(call, name, value) => {
                    let is_plain = self.runs(file, graph, call) == Execution::Always
                        && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_))
                        && !self.is_object_prototype_name(name);
                    if !is_plain || module.getters.insert(name, (call, value)).is_some() {
                        module.obstacle = Some("a getter is defined late, or twice");
                    }
                    module.is_exact_outside_cycles = true;
                }
                Use::Interop(..) => module.obstacle = Some("it is passed to a function"),
                Use::CopyCondition(declaration) => {
                    let pat = hir[declaration].pat;
                    let local = bound.pat_symbol[pat.idx()];
                    let is_plain = bound.symbols.get(local.idx()).is_some_and(|symbol| {
                        symbol.decls.len() == 1 && !symbol.flags.contains(SymFlags::MERGED)
                    }) && bound.assignments_to(local).is_empty()
                        && !self.is_stored_through_casts(file, local)
                        && hir[declaration].ty.is_none()
                        && !hir[declaration]
                            .flags
                            .intersects(Flags::EXPORT | Flags::AMBIENT);
                    match hir[pat].kind {
                        PatKind::Ident(name) if is_plain => {
                            let holder = self.files().sym(file, local);
                            for &reference in by_kind.of(ExprTag::Ident) {
                                if matches!(hir[reference].kind, ExprKind::Ident(named) if named == name)
                                    && bound.expr_parent[reference.idx()] != Parent::None
                                    && self.identifier_binding(file, reference, name)
                                        == Some(holder)
                                {
                                    module.mentions.push(reference);
                                }
                            }
                        }
                        _ => {
                            module.obstacle = Some(
                                "a variable of the module holds it, which is stored to, or a pattern",
                            )
                        }
                    }
                }
                Use::Exported => module.obstacle = Some("module.exports or exports is assigned"),
                Use::Other(why) => module.obstacle = Some(why),
            }
        }
        if module.re_exports.is_some() && module.mentions.len() != 1 {
            module.obstacle = Some("module.exports = require(..), and more is done with it");
        }
        if module
            .getters
            .keys()
            .any(|name| module.reads.contains(name))
        {
            module.obstacle = Some("a name with a getter is read by the module itself");
        }
        let replaced: Vec<Atom> = module
            .getters
            .keys()
            .copied()
            .filter(|name| module.stores.contains_key(name))
            .collect();
        for name in replaced {
            let defined_at = hir[module.getters[&name].0].pos;
            let is_void = |mut value: ExprId| {
                while let Some(ExprKind::Assign {
                    op: None,
                    value: inner,
                    ..
                }) = value.some().map(|value| hir[value].kind)
                {
                    value = inner;
                }
                value.is_some()
                    && matches!(hir[value].kind, ExprKind::Unary { op: UnOp::Void, .. })
                    && hir[value].pos < defined_at
            };
            if module.reads.contains(&name)
                || !module.stores[&name]
                    .iter()
                    .all(|store| store.runs == Execution::Always && is_void(store.value))
            {
                module.obstacle = Some("a name with a getter is stored to");
            }
            module.stores.remove(&name);
            module.is_exact_outside_cycles = true;
        }
        if let Some(ExprKind::Object(props)) =
            module.literal.some().map(|literal| hir[literal].kind)
        {
            let end = hir[module.literal].end;
            let comes_first = module.mentions.iter().all(|&e| {
                !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This)
                    && (hir[e].end <= hir[module.literal].pos
                        || hir[e].pos >= end
                        || self.runs(file, graph, e) == Execution::Later)
            });
            let stored_at = hir[if module.name_of_literal.is_some() {
                module.name_of_literal
            } else {
                module.literal
            }]
            .pos;
            let before = module
                .mentions
                .iter()
                .filter(|&&e| {
                    hir[e].pos < stored_at && self.runs(file, graph, e) != Execution::Later
                })
                .count();
            if !comes_first
                || before != 1
                || !module.getters.is_empty()
                || module.is_marked() && hir[module.marker].pos < end
                || module
                    .stores
                    .values()
                    .flatten()
                    .any(|store| store.runs == Execution::Later)
            {
                module.obstacle =
                    Some("module.exports = { .. } is not all that defines the exports");
            }
            for prop in props.iter() {
                let value = hir[prop].value;
                let is_plain = match hir[prop].kind {
                    PropKind::Init | PropKind::Shorthand => true,
                    PropKind::Method => {
                        matches!(hir[value].kind, ExprKind::Fn(func) if !self.uses_this(file, func))
                    }
                    _ => false,
                };
                match hir[prop].key {
                    PropKey::Name(name)
                        if is_plain
                            && !self.is_object_prototype_name(name)
                            && name != known::__esModule =>
                    {
                        module.stores.entry(name).or_default().push(Store {
                            value,
                            runs: Execution::Always,
                        })
                    }
                    _ => {
                        module.obstacle = Some("module.exports = { .. } with more than plain names")
                    }
                }
            }
        }
        if let Some(stores) = module.stores.get(&known::__esModule)
            && (stores.len() != 1 || !module.is_marked())
        {
            module.obstacle = Some("__esModule is stored to");
        }
        module
    }

    fn required_by_folded_specifier(&self, file: FileId, graph: &Graph, e: ExprId) -> Vec<FileId> {
        let specifiers = self.hir(file).folded_require_specifiers(e);
        specifiers
            .into_iter()
            .filter_map(|specifier| graph.required(file, specifier))
            .collect()
    }

    fn modules_exposed(
        &mut self,
        graph: &Graph,
        in_parallel: Option<InParallel<'_>>,
    ) -> FxHashSet<FileId> {
        let found = self.map_slices(
            &graph.modules,
            FILES_PER_CHECKER,
            in_parallel,
            &|c, files| {
                let mut pending: Vec<FileId> = Vec::new();
                for &file in files {
                    for &e in c.file_exprs_by_kind(file).of(ExprTag::Call) {
                        pending.extend(c.required_by_folded_specifier(file, graph, e));
                        let Some(specifier) = c.require_call_specifier(file, e) else {
                            continue;
                        };
                        if let Some(module) = graph.required(file, specifier)
                            && c.runs(file, graph, e) == Execution::Later
                        {
                            pending.push(module);
                        }
                    }
                }
                pending
            },
        );
        let mut pending: Vec<FileId> = found.into_iter().flatten().collect();
        let mut evaluates: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        for (from, &to) in graph
            .resolved
            .iter()
            .map(|(from, to)| (from.0, to))
            .chain(graph.implicit.iter().map(|import| (import.0, &import.1)))
        {
            evaluates.entry(from).or_default().push(to);
        }
        let mut exposed = FxHashSet::default();
        while let Some(module) = pending.pop() {
            if exposed.insert(module) {
                pending.extend(evaluates.get(&module).into_iter().flatten());
            }
        }
        exposed
    }

    pub fn references_module_cache_alias(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        self.destructures_module_cache(file)
            || self.file_exprs_by_kind(file).of(ExprTag::Dot).iter().any(|&e| matches!(hir[e].kind, ExprKind::Dot { obj, name, .. } if self.atoms().bytes(name) == b"_cache" && self.is_module_constructor_ref(file, obj)))
    }

    fn destructures_module_cache(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        let is_cache = |name: Atom| self.atoms().bytes(name) == b"_cache";
        let may_access_cache = |prop: &crate::hir::PatProp| {
            prop.is_rest
                || match prop.key {
                    PropKey::Name(name) => is_cache(name),
                    PropKey::None => {
                        matches!(hir[prop.value].kind, PatKind::Ident(name) if is_cache(name))
                    }
                    PropKey::Computed(_) => true,
                    PropKey::Private(_) => false,
                }
        };
        hir.imports.iter().any(|import| self.is_builtin_module_specifier(import.spec, b"module") && import.named.iter().any(|spec| is_cache(hir[spec].imported)))
            || hir.var_decls.iter().any(|declaration| {
                declaration.init.is_some() && matches!(hir[declaration.pat].kind, PatKind::Object(props) if props.iter().any(|prop| may_access_cache(&hir[prop]))) && self.is_module_constructor_ref(file, declaration.init)
            })
    }

    fn is_module_constructor_ref(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_computed_require = |e: ExprId| {
            matches!(hir[e].kind, ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, ExprKind::Ident(of) if of == known::require))
                && required_specifier(hir, e).is_none()
        };
        if let Some(specifier) = required_specifier(hir, e) {
            return self.is_builtin_module_specifier(specifier, b"module");
        }
        if is_computed_require(e) {
            return true;
        }
        if let ExprKind::Dot { obj, name, .. } = hir[e].kind {
            return self.atoms().bytes(name) == b"constructor"
                && matches!(hir[obj].kind, ExprKind::Ident(of) if of == known::module);
        }
        let Some(symbol) = bound.symbols.get(bound.expr_symbol[e.idx()].idx()) else {
            return false;
        };
        symbol.decls.iter().any(|decl| match *decl {
            Decl::Var(pat) | Decl::Require(pat) => {
                matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if hir[declaration].init.is_some() && (is_computed_require(hir[declaration].init) || required_specifier(hir, hir[declaration].init).is_some_and(|specifier| self.is_builtin_module_specifier(specifier, b"module"))))
            }
            Decl::ImportNamespace(import) | Decl::ImportDefault(import) => self.is_builtin_module_specifier(hir[import].spec, b"module"),
            _ => false,
        })
    }

    fn record_commonjs_module_uses(
        &mut self,
        file: FileId,
        graph: &Graph,
        modules: &FxHashMap<FileId, Module>,
        holder_by_symbol: &impl Fn(&FxHashMap<FileId, Module>, FileId) -> FileId,
        in_cycles: &FxHashMap<FileId, u32>,
        exposed: &FxHashSet<FileId>,
        uses: &mut Uses,
    ) {
        let (hir, bound, by_kind) = (
            self.hir(file),
            self.bound(file),
            self.file_exprs_by_kind(file),
        );
        let commonjs = |specifier: Atom| {
            graph
                .resolved
                .get(&(file, specifier))
                .copied()
                .filter(|module| modules.contains_key(module))
        };
        let mut pending: Vec<(ExprId, ExportsReference)> = Vec::new();
        let mut copy_condition: Vec<(Atom, Holder, ExportsReference)> = Vec::new();
        if graph.reevaluated.contains(&file) && modules.contains_key(&file) {
            uses.looked_at.push((file, "it may be evaluated again"));
        }
        let is_require_cache = |&e: &ExprId| match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => match self.atoms().bytes(name) {
                b"cache" | b"extensions" => {
                    matches!(hir[obj].kind, ExprKind::Ident(of) if of == known::require)
                }
                b"_cache" | b"_extensions" => self.is_module_constructor_ref(file, obj),
                b"_resolveFilename" => {
                    matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { target, .. } if target == e))
                }
                _ => false,
            },
            _ => false,
        };
        let is_module_children = |&e: &ExprId| match hir[e].kind {
            ExprKind::Dot { obj, name, .. } if self.atoms().bytes(name) == b"children" => {
                match hir[obj].kind {
                    ExprKind::Ident(of) => of == known::module,
                    ExprKind::Dot { name, .. } => self.atoms().bytes(name) == b"parent",
                    _ => false,
                }
            }
            _ => false,
        };
        uses.are_children_read |=
            graph.preserves_source_paths && by_kind.of(ExprTag::Dot).iter().any(is_module_children);
        let is_prototype_require = |&e: &ExprId| match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => {
                self.atoms().bytes(name) == b"require"
                    && matches!(hir[obj].kind, ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"prototype")
            }
            _ => false,
        };
        if graph.preserves_source_paths
            && (by_kind
                .of(ExprTag::Dot)
                .iter()
                .any(|e| is_require_cache(e) || is_prototype_require(e))
                || self.destructures_module_cache(file))
        {
            let mut all: Vec<FileId> = modules.keys().copied().collect();
            all.sort_unstable();
            uses.looked_at.extend(
                all.into_iter()
                    .map(|module| (module, "require.cache is read")),
            );
            uses.is_cache_read = true;
        }
        for &e in by_kind.of(ExprTag::Call) {
            for module in self.required_by_folded_specifier(file, graph, e) {
                if modules.contains_key(&module) {
                    uses.required_by_functions.insert(module);
                    uses.looked_at
                        .push((module, "require() of a specifier that is folded"));
                }
            }
            let Some(specifier) = self.require_call_specifier(file, e) else {
                continue;
            };
            if let Some(module) = graph
                .required(file, specifier)
                .filter(|module| modules.contains_key(module))
                && self.runs(file, graph, e) != Execution::Never
            {
                if self.runs(file, graph, e) == Execution::Later {
                    uses.required_by_functions.insert(module);
                } else if !exposed.contains(&file)
                    && !graph.reevaluated.contains(&module)
                    && in_cycles
                        .get(&file)
                        .is_none_or(|cycle| in_cycles.get(&module) != Some(cycle))
                {
                    uses.requires_of_evaluated_modules.insert((file, e));
                }
                pending.push((e, ExportsReference::new(module)));
            }
        }
        for &e in by_kind.of(ExprTag::ImportCall) {
            if let ExprKind::ImportCall { args } = hir[e].kind
                && let Some(specifier) = hir.ids(args).next()
            {
                for module in hir
                    .folded_specifier_choices(specifier)
                    .into_iter()
                    .filter_map(commonjs)
                {
                    uses.imported_by_es_modules.insert((file, module));
                    uses.looked_at
                        .push((module, "import() of a specifier that is folded"));
                }
            }
            if let ExprKind::ImportCall { args } = hir[e].kind
                && let Some(ExprKind::String(specifier)) = hir
                    .ids(args)
                    .next()
                    .map(|specifier: ExprId| hir[specifier].kind)
                && let Some(module) = commonjs(specifier)
            {
                uses.imported_by_es_modules.insert((file, module));
                match bound.expr_parent[e.idx()] {
                    Parent::Expr(awaited)
                        if matches!(hir[awaited].kind, ExprKind::Await(_))
                            && hir.ids(args).count() == 1 =>
                    {
                        uses.awaited.push(module);
                        pending.push((
                            awaited,
                            ExportsReference {
                                is_namespace: true,
                                ..ExportsReference::new(module)
                            },
                        ));
                    }
                    _ => uses
                        .looked_at
                        .push((module, "import() that is not awaited on the spot")),
                }
            }
        }
        for stmt in hir.ids(hir.body) {
            match hir[stmt].kind {
                StmtKind::Import(import) if !hir[import].type_only => {
                    let Some(module) = commonjs(hir[import].spec) else {
                        continue;
                    };
                    uses.imported_by_es_modules.insert((file, module));
                    let retained = &modules[&holder_by_symbol(modules, module)];
                    let has_own_default_property = !self.ignores_es_module_marker(file, module)
                        && retained.is_marked()
                        && retained.has(known::default);
                    let mut bindings = Vec::new();
                    if hir[import].default.is_some() && !has_own_default_property {
                        bindings.push((hir[import].default, Decl::ImportDefault(import), false));
                    }
                    if hir[import].namespace.is_some() {
                        bindings.push((hir[import].namespace, Decl::ImportNamespace(import), true));
                    }
                    for spec in hir[import].named.iter() {
                        if !hir[spec].type_only
                            && hir[spec].imported == known::default
                            && !has_own_default_property
                        {
                            bindings.push((hir[spec].local, Decl::ImportSpec(spec), false));
                        }
                    }
                    for (name, decl, is_namespace) in bindings {
                        if hir.exports.iter().any(|export| {
                            export.spec.is_none()
                                && export.items.iter().any(|item| hir[item].local == name)
                        }) {
                            uses.looked_at
                                .push((module, "an import of all of it is exported again"));
                            continue;
                        }
                        copy_condition.push((
                            name,
                            Holder::Import(decl),
                            ExportsReference {
                                module,
                                is_namespace,
                                is_boxed: false,
                            },
                        ));
                    }
                }
                StmtKind::ExportNamed(export)
                    if !hir[export].type_only && hir[export].spec.is_some() =>
                {
                    let Some(module) = commonjs(hir[export].spec) else {
                        continue;
                    };
                    uses.imported_by_es_modules.insert((file, module));
                    if hir[export]
                        .items
                        .iter()
                        .any(|item| hir[item].local == known::default)
                    {
                        uses.looked_at.push((module, "export { default } from"));
                    }
                }
                StmtKind::ExportStar {
                    spec,
                    type_only: false,
                    ..
                } => uses
                    .looked_at
                    .extend(commonjs(spec).map(|module| (module, "export * from"))),
                StmtKind::ImportEquals(import) => {
                    if let ImportEqualsTarget::Require(specifier) = hir[import].target {
                        uses.looked_at.extend(
                            graph
                                .required(file, specifier)
                                .filter(|module| modules.contains_key(module))
                                .map(|module| (module, "import = require()")),
                        );
                    }
                }
                _ => {}
            }
        }
        let mut followed = 0;
        loop {
            while let Some((e, mention)) = pending.pop() {
                uses.mentions.push((file, e, mention));
                let module = mention.module;
                if let Some((name, local)) = self.single_store_variable_for(file, graph, e) {
                    copy_condition.push((
                        name,
                        Holder::Variable(self.files().sym(file, local)),
                        mention,
                    ));
                    continue;
                }
                let found = self.exports_use(file, e);
                if !matches!(found, Use::Nothing)
                    && !matches!(found, Use::CopyCondition(declaration) if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)))
                {
                    uses.readers.insert((file, module));
                }
                match found {
                    Use::Member(member, name) if mention.is_boxed => {
                        match self.member_use(file, member) {
                            MemberUse::Read if name == known::default => {
                                pending.push((member, ExportsReference::new(module)))
                            }
                            _ => uses.looked_at.push((
                                module,
                                "what an interop helper has made is used for more than its default",
                            )),
                        }
                    }
                    Use::Member(member, name) => {
                        let retained = &modules[&holder_by_symbol(modules, module)];
                        if mention.is_namespace
                            && (name == known::__esModule
                                || name == known::default
                                    && !retained.is_marked()
                                    && retained.has(known::default))
                        {
                            uses.looked_at.push((module, "ns.__esModule, or ns.default of a module that is not marked and has one"));
                        }
                        if mention.is_namespace
                            && name == known::default
                            && (self.ignores_es_module_marker(file, module)
                                || !retained.is_marked()
                                || !retained.has(known::default))
                        {
                            pending.push((member, ExportsReference::new(module)));
                            continue;
                        }
                        if self.is_object_prototype_name(name) {
                            uses.looked_at.push((module, "a name of Object.prototype"));
                        }
                        match self.member_use(file, member) {
                            MemberUse::Read => {}
                            MemberUse::Call => uses.methods.push((module, name)),
                            _ => uses
                                .looked_at
                                .push((module, "another module stores to it or deletes from it")),
                        }
                    }
                    Use::Nothing => {}
                    Use::CopyCondition(declaration) => {
                        let pat = hir[declaration].pat;
                        match hir[pat].kind {
                            PatKind::Ident(name) => {
                                let local = bound.pat_symbol[pat.idx()];
                                let is_plain = !self.has_direct_eval(file)
                                    && bound.symbols.get(local.idx()).is_some_and(|symbol| {
                                        symbol.decls.len() == 1
                                            && !symbol.flags.contains(SymFlags::MERGED)
                                    })
                                    && bound.assignments_to(local).is_empty()
                                    && !self.is_stored_through_casts(file, local)
                                    && hir[declaration].ty.is_none()
                                    && !hir[declaration]
                                        .flags
                                        .intersects(Flags::EXPORT | Flags::AMBIENT)
                                    && !hir.exports.iter().any(|export| {
                                        export.spec.is_none()
                                            && export
                                                .items
                                                .iter()
                                                .any(|item| hir[item].local == name)
                                    });
                                if is_plain {
                                    copy_condition.push((
                                        name,
                                        Holder::Variable(self.files().sym(file, local)),
                                        mention,
                                    ));
                                } else {
                                    uses.looked_at.push((module, "a variable that is stored to, exported or declared twice holds it"));
                                }
                            }
                            PatKind::Object(props)
                                if !mention.is_boxed && hir[declaration].ty.is_none() =>
                            {
                                let retained = &modules[&holder_by_symbol(modules, module)];
                                let is_node_mode = self.ignores_es_module_marker(file, module);
                                let is_whole = |name: Atom| {
                                    mention.is_namespace
                                        && (name == known::__esModule
                                            || name == known::default
                                                && (is_node_mode
                                                    || !retained.is_marked()
                                                    || !retained.has(known::default)))
                                };
                                for prop in props.iter() {
                                    let name = match (hir[prop].key, hir[hir[prop].value].kind) {
                                        _ if hir[prop].is_rest => None,
                                        (PropKey::Name(name), _)
                                        | (PropKey::None, PatKind::Ident(name)) => Some(name),
                                        _ => None,
                                    };
                                    if name.is_none_or(|name| {
                                        self.is_object_prototype_name(name) || is_whole(name)
                                    }) {
                                        uses.looked_at.push((
                                            module,
                                            "a pattern with a rest or a computed key",
                                        ));
                                    }
                                }
                            }
                            _ => uses.looked_at.push((module, "it is used as a value")),
                        }
                    }
                    Use::Exported
                        if modules
                            .get(&file)
                            .is_some_and(|importer| importer.re_exports == Some(module)) => {}
                    Use::Interop(call, helper) => {
                        let keeper = holder_by_symbol(modules, module);
                        let retained = &modules[&keeper];
                        let may_be_early = in_cycles
                            .get(&keeper)
                            .is_some_and(|cycle| in_cycles.get(&file) == Some(cycle))
                            || exposed.contains(&file)
                            || self.runs(file, graph, call) == Execution::Later;
                        let is_marked_late = retained.is_marked()
                            && may_be_early
                            && self.hir(keeper)[retained.marker].pos
                                > self.first_module_effect(keeper);
                        if mention.is_namespace
                            || mention.is_boxed
                            || !retained.is_marked() && helper != Helper::Boxes
                            || is_marked_late
                        {
                            uses.looked_at.push((module, "an interop helper copies it"));
                        } else {
                            pending.push((
                                call,
                                ExportsReference {
                                    is_boxed: !retained.is_marked(),
                                    ..mention
                                },
                            ));
                        }
                    }
                    Use::Starred(call)
                        if !mention.is_namespace
                            && !mention.is_boxed
                            && matches!(hir[e].kind, ExprKind::Call(_)) =>
                    {
                        uses.starred.push((file, call, module))
                    }
                    Use::Starred(_) | Use::StarredInto(_) => uses.looked_at.push((
                        module,
                        "it is passed to __exportStar, but not as the result of `require`",
                    )),
                    Use::Exported | Use::Assigned(_) | Use::Marked(_) | Use::Defined(..) => {
                        uses.looked_at.push((module, "it is used as a value"))
                    }
                    Use::Other(why) => uses.looked_at.push((module, why)),
                }
            }
            if followed == copy_condition.len() {
                break;
            }
            let names = &copy_condition[followed..];
            for &e in by_kind.of(ExprTag::Ident) {
                let ExprKind::Ident(name) = hir[e].kind else {
                    continue;
                };
                if !names.iter().any(|binding| binding.0 == name)
                    || bound.expr_parent[e.idx()] == Parent::None
                    || bound.is_in_type_query(e)
                {
                    continue;
                }
                if matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Assign { target, .. } if target == e))
                {
                    continue;
                }
                let Some(found) = self.identifier_binding(file, e, name) else {
                    continue;
                };
                let is_stored_in = |holder: Holder| match holder {
                    Holder::Variable(sym) => sym == found,
                    Holder::Import(decl) => self.files().decls_of(found).contains(&(file, decl)),
                };
                if let Some(binding) = names
                    .iter()
                    .find(|binding| binding.0 == name && is_stored_in(binding.1))
                {
                    pending.push((e, binding.2));
                }
            }
            if self.files().jsx_runtime(file).is_none() {
                for &e in by_kind.of(ExprTag::Jsx) {
                    for is_fragment_tag in [false, true] {
                        let (_, Some(found)) = self.classic_jsx_factory(file, e, is_fragment_tag)
                        else {
                            continue;
                        };
                        let is_stored_in = |holder: Holder| match holder {
                            Holder::Variable(sym) => sym == found,
                            Holder::Import(decl) => {
                                self.files().decls_of(found).contains(&(file, decl))
                            }
                        };
                        for binding in names.iter().filter(|binding| is_stored_in(binding.1)) {
                            uses.looked_at.push((
                                binding.2.module,
                                "the classic JSX runtime reads its factory from it",
                            ));
                        }
                    }
                }
            }
            for found in self.decorator_referenced_values(file) {
                let is_stored_in = |holder: Holder| match holder {
                    Holder::Variable(sym) => sym == found,
                    Holder::Import(decl) => self.files().decls_of(found).contains(&(file, decl)),
                };
                for binding in names.iter().filter(|binding| is_stored_in(binding.1)) {
                    uses.looked_at.push((
                        binding.2.module,
                        "the metadata of a decorator reads a type from it",
                    ));
                }
            }
            let mut alias_symbols = None;
            for (index, declared) in hir.import_equals.iter().enumerate() {
                let ImportEqualsTarget::Entity(path) = declared.target else {
                    continue;
                };
                let Some(root) = hir.texts(path).next() else {
                    continue;
                };
                if !names.iter().any(|binding| binding.0 == root) {
                    continue;
                }
                let alias_symbols =
                    alias_symbols.get_or_insert_with(|| self.symbols_of_alias_declarations(file));
                if !alias_symbols
                    .get(&Decl::ImportEquals(ImportEqualsId(index as u32)))
                    .is_some_and(|&alias| {
                        self.files().symbol_flags(alias).intersects(SymFlags::VALUE)
                    })
                {
                    continue;
                }
                let Some(found) = self.files().resolve_entity(
                    file,
                    bound.import_equals_scope[index],
                    &[root],
                    SymFlags::VALUE | SymFlags::NAMESPACE | SymFlags::ALIAS,
                ) else {
                    continue;
                };
                let is_stored_in = |holder: Holder| match holder {
                    Holder::Variable(sym) => sym == found,
                    Holder::Import(decl) => self.files().decls_of(found).contains(&(file, decl)),
                };
                for binding in names.iter().filter(|binding| is_stored_in(binding.1)) {
                    uses.looked_at
                        .push((binding.2.module, "an import alias reads a member of it"));
                }
            }
            followed = copy_condition.len();
        }
    }
}

fn modules_in_cycles(graph: &Graph) -> FxHashMap<FileId, u32> {
    let mut evaluates: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    let mut evaluated_by: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    let mut in_cycles = FxHashMap::default();
    let mut self_requiring = Vec::new();
    let mut edges: Vec<(FileId, FileId)> = graph
        .resolved
        .iter()
        .map(|(from, &to)| (from.0, to))
        .chain(graph.implicit.iter().copied())
        .collect();
    edges.sort_unstable();
    edges.dedup();
    for (from, to) in edges {
        evaluates.entry(from).or_default().push(to);
        evaluated_by.entry(to).or_default().push(from);
        if from == to {
            self_requiring.push(from);
        }
    }
    let (mut left, mut seen) = (Vec::new(), FxHashSet::default());
    for &root in &graph.modules {
        let mut path = if seen.insert(root) {
            vec![(root, 0)]
        } else {
            Vec::new()
        };
        while let Some(&(module, next)) = path.last() {
            match evaluates
                .get(&module)
                .and_then(|evaluated| evaluated.get(next))
            {
                Some(&evaluated) => {
                    if let Some(top) = path.last_mut() {
                        top.1 += 1;
                    }
                    if seen.insert(evaluated) {
                        path.push((evaluated, 0));
                    }
                }
                None => {
                    left.push(module);
                    path.pop();
                }
            }
        }
    }
    let mut numbered = FxHashSet::default();
    for &root in left.iter().rev() {
        if !numbered.insert(root) {
            continue;
        }
        let (mut members, mut at) = (vec![root], 0);
        while at < members.len() {
            for &by in evaluated_by.get(&members[at]).into_iter().flatten() {
                if numbered.insert(by) {
                    members.push(by);
                }
            }
            at += 1;
        }
        if members.len() > 1 || self_requiring.contains(&root) {
            in_cycles.extend(members.into_iter().map(|member| (member, root.0)));
        }
    }
    in_cycles
}

use super::{
    BuiltinPath, FileFacts, ImportTargets, ResolveInput, Resolved, ResolvedBuiltins, SourceDialect,
    resolve_file, resolve_within, resolver,
};
use crate::builtins::names::BuiltinNames;
use crate::builtins::table::{
    self, BuiltinId, BuiltinName, Intrinsic, MemberLookup, Mutability, Platforms, RuntimeModule,
};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, Bound, Decl, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions};
use bun_sema::hir::{self, ExprId, PatKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::{Arena, Session};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use core::ops::Range;
use std::borrow::Cow;

macro_rules! case_tests {
    ($($test:ident: $setup:expr, $source:expr, |$case:ident| $body:expr;)*) => {$(
        #[test]
        fn $test() {
            with_case($setup, $source, |$case| $body);
        }
    )*};
}

mod aliases;
mod bindings;
mod calls_for_texts;
mod evaluated_text;
mod exposure;
mod folding;
mod imports;
mod module_objects;
mod module_values;
mod parts_of_a_file;
mod paths;
mod runtime_dialect;
mod unknown_loads;

const MAX_FOLDED_STRING_BYTES: usize = 1 << 16;

const MODULES: &[(&str, RuntimeModule)] = &[
    ("bun:jsc", RuntimeModule::BunJsc),
    ("bun", RuntimeModule::Bun),
    ("node:fs", RuntimeModule::NodeFs),
    ("node:module", RuntimeModule::NodeModule),
    ("node:process", RuntimeModule::NodeProcess),
    ("node:vm", RuntimeModule::NodeVm),
    ("utf-8-validate", RuntimeModule::Utf8Validate),
];

type DefinedPath = (&'static [&'static str], &'static [&'static str]);

#[derive(Copy, Clone)]
struct Setup {
    path: &'static str,
    dialect: SourceDialect,
    defines: &'static [DefinedPath],
    jsx_factory_root: Option<&'static str>,
    emits_decorator_metadata: bool,
    platform: Platforms,
}

const PROGRAM: Setup = Setup {
    path: "/project/a.ts",
    dialect: SourceDialect::Program,
    defines: &[],
    jsx_factory_root: None,
    emits_decorator_metadata: false,
    platform: Platforms::LINUX,
};
const SCRIPT: Setup = Setup {
    path: "/project/a.cjs",
    ..PROGRAM
};
const RUNTIME: Setup = Setup {
    path: "/$bun/js/node/example.ts",
    dialect: SourceDialect::Runtime,
    ..PROGRAM
};

struct Case<'a, 's> {
    source: &'a str,
    atoms: &'a Interner<'s>,
    names: &'a BuiltinNames,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    resolved: &'a ResolvedBuiltins,
    // How many expressions the resolver has kept a state of.
    states: usize,
}

fn intern_all<'s>(texts: &[&str], atoms: &Interner<'s>, arena: &'s Arena) -> &'s [Atom] {
    let atoms: Vec<Atom> = texts
        .iter()
        .map(|text| atoms.intern(text.as_bytes()))
        .collect();
    arena.alloc_slice_copy(&atoms)
}

fn create_define<'s>(
    (path, value): DefinedPath,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Define<'s> {
    let (root, members) = path
        .split_first()
        .expect("a define path starts with a name");
    Define {
        path: DefinePath {
            root: DefineRoot::Global(atoms.intern(root.as_bytes())),
            members: intern_all(members, atoms, arena),
        },
        value: DefineValue::GlobalPath(intern_all(value, atoms, arena)),
    }
}

fn create_fold_inputs<'s>(setup: Setup, atoms: &Interner<'s>, arena: &'s Arena) -> FoldInputs<'s> {
    let defines = setup.defines.iter();
    let defines: Vec<Define<'s>> = defines
        .map(|&define| create_define(define, atoms, arena))
        .collect();
    let options = FoldOptions {
        defines: arena.alloc_slice_copy(&defines),
        max_string_bytes: MAX_FOLDED_STRING_BYTES,
        ..FoldOptions::default()
    };
    FoldInputs::new(options, arena)
}

fn find_target(atoms: &Interner<'_>, specifier: ImportSpecifier) -> Option<RuntimeModule> {
    let text = match specifier {
        ImportSpecifier::Constant(text) => atoms.bytes(text),
        ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => return None,
    };
    let module = MODULES.iter().find(|module| module.0.as_bytes() == text);
    module.map(|module| module.1)
}

// The facts of the file change nothing in what is found in a part of it.
fn assert_same_answers(with_facts: &ResolvedBuiltins, without: &ResolvedBuiltins, source: &str) {
    let describe = |resolved: &ResolvedBuiltins| {
        format!(
            "{:?} {:?} {:?} {:?} {:?} {:?} {:?} {:?} {:?} {:?}",
            resolved.exprs,
            resolved.expr_bits,
            resolved.symbols,
            resolved.evaluated_texts,
            resolved.module_object_mentions,
            resolved.stores_with_module_exports,
            resolved.mentioned,
            resolved.exposed,
            resolved.uses,
            resolved.loads_unknown_modules,
        )
    };
    assert_eq!(describe(with_facts), describe(without), "{source}");
}

fn with_case<R>(setup: Setup, source: &str, then: impl FnOnce(&Case<'_, '_>) -> R) -> R {
    with_parts(setup, source, None, then)
}

// `parts`: only the code in these pieces of the source counts. They stand in it in this order, each once.
fn with_parts<R>(
    setup: Setup,
    source: &str,
    parts: Option<&[&str]>,
    then: impl FnOnce(&Case<'_, '_>) -> R,
) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let names = BuiltinNames::new(&atoms);
    let arena = session.arena();
    let parse_options = CompileParseOptions {
        path: setup.path.as_bytes(),
        script_kind: None,
        experimental_decorators: setup.emits_decorator_metadata,
        every_file_is_a_module: false,
        reads_jsdoc: true,
        keeps_function_directives: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, source.as_bytes(), &atoms);
    hir.text = Cow::Borrowed(source.as_bytes());
    let fold = create_fold_inputs(setup, &atoms, arena);
    let jsx_factory_root = setup.jsx_factory_root;
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions {
            jsx_factory_root: jsx_factory_root.map(|root| atoms.intern(root.as_bytes())),
            jsx_fragment_root: None,
            emits_decorator_metadata: setup.emits_decorator_metadata,
            hoists_top_level_variables: false,
        }),
        ..BindOptions::default()
    };
    let declared_module_type = match setup.path.ends_with(".cjs") {
        true => DeclaredModuleType::CommonJs,
        false => DeclaredModuleType::Unknown,
    };
    let file = FileInputs {
        declared_module_type,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    assert!(
        !hir.has_errors && !hir.has_parse_diagnostics,
        "syntax error in: {source}"
    );

    let sites = analysis.import_sites.iter();
    let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
        .map(|site| (site.kind, find_target(&atoms, site.specifier)))
        .collect();
    targets.sort_unstable_by_key(|target| target.0);
    let targets = ImportTargets::new(&targets);
    let input = ResolveInput {
        hir: &hir,
        bound: &bound,
        decisions: &analysis.decisions,
        module_format: analysis.module_format,
        targets: &targets,
        names: &names,
        platform: setup.platform,
        dialect: setup.dialect,
    };
    let range_of = |part: &&str| {
        let start = source.find(part).expect("the part stands in the source") as u32;
        start..start + part.len() as u32
    };
    let facts = FileFacts::new(&input);
    let resolve_part = |ranges: &[Range<u32>]| {
        let resolved = resolve_within(&input, ranges, &facts);
        assert_same_answers(
            &resolved,
            &resolver::run(&input, Some(ranges), None),
            source,
        );
        resolved
    };
    let ranges_of_parts = parts.map(|parts| parts.iter().map(range_of).collect::<Vec<_>>());
    let states = match &ranges_of_parts {
        None => hir.exprs.len(),
        Some(ranges) => resolver::count_states(&input, ranges, &facts),
    };
    let resolved = match parts {
        None => {
            let ends = source
                .match_indices([';', '{', '}'])
                .map(|found| found.0 as u32 + 1);
            for end in ends.take(24) {
                resolve_part(&[0..end]);
                resolve_part(&[end..source.len() as u32]);
            }
            resolve_file(&input)
        }
        Some(_) => resolve_part(ranges_of_parts.as_deref().unwrap_or_default()),
    };
    then(&Case {
        source,
        atoms: &atoms,
        names: &names,
        hir: &hir,
        bound: &bound,
        resolved: &resolved,
        states,
    })
}

fn find_ids<T, Id: From<u32>>(
    nodes: &[T],
    is_match: impl Fn(&T) -> bool,
) -> impl Iterator<Item = Id> {
    (0u32..)
        .zip(nodes)
        .filter(move |&(_, node)| is_match(node))
        .map(|(index, _)| Id::from(index))
}

impl Case<'_, '_> {
    fn text_at(&self, pos: u32, end: u32) -> &str {
        self.source.get(pos as usize..end as usize).unwrap_or("")
    }

    fn text_of(&self, expr: ExprId) -> &str {
        let expr = &self.hir[expr];
        self.text_at(expr.pos, expr.end)
    }

    fn exprs(&self, text: &str) -> Vec<ExprId> {
        find_ids(&self.hir.exprs, |expr: &hir::Expr| {
            self.text_at(expr.pos, expr.end) == text
        })
        .collect()
    }

    #[track_caller]
    fn expr(&self, text: &str) -> ExprId {
        let found = self.exprs(text).last().copied();
        found.unwrap_or_else(|| panic!("no expression `{text}` in: {}", self.source))
    }

    fn resolved_at(&self, expr: ExprId) -> Option<Resolved> {
        self.resolved.of_expr(expr)
    }

    fn path_at(&self, expr: ExprId) -> Option<BuiltinPath> {
        match self.resolved_at(expr) {
            Some(Resolved::Builtin(path)) => Some(path),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
        }
    }

    fn intrinsic_of_expr(&self, expr: ExprId) -> Option<Intrinsic> {
        match self.resolved_at(expr) {
            Some(Resolved::Intrinsic(intrinsic)) => Some(intrinsic),
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_)) | None => None,
        }
    }

    fn dynamic_global_at(&self, expr: ExprId) -> Option<BuiltinPath> {
        match self.resolved_at(expr) {
            Some(Resolved::DynamicGlobal(path)) => Some(path),
            Some(Resolved::Builtin(_) | Resolved::Intrinsic(_)) | None => None,
        }
    }

    #[track_caller]
    fn path(&self, text: &str) -> Option<BuiltinPath> {
        self.path_at(self.expr(text))
    }

    #[track_caller]
    fn builtin(&self, text: &str) -> Option<BuiltinId> {
        self.path(text).map(|path| path.id)
    }

    #[track_caller]
    fn intrinsic(&self, text: &str) -> Option<Intrinsic> {
        self.intrinsic_of_expr(self.expr(text))
    }

    #[track_caller]
    fn intrinsic_at(&self, text: &str, index: usize) -> Option<Intrinsic> {
        self.intrinsic_of_expr(self.exprs(text)[index])
    }

    fn find_declaration(&self, name: &str) -> Option<Decl> {
        let hir = self.hir;
        let name = self.atoms.intern(name.as_bytes());
        let patterns = find_ids(
            &hir.pats,
            |pattern: &hir::Pat| matches!(pattern.kind, PatKind::Ident(text) if text == name),
        );
        let specifiers = find_ids(&hir.import_specs, |spec: &hir::ImportSpec| {
            spec.local == name
        });
        let defaults = find_ids(&hir.imports, |import: &hir::Import| import.default == name);
        let namespaces = find_ids(&hir.imports, |import: &hir::Import| {
            import.namespace == name
        });
        let import_equals = find_ids(&hir.import_equals, |import: &hir::ImportEquals| {
            import.name == name
        });
        patterns
            .map(Decl::Var)
            .chain(specifiers.map(Decl::ImportSpec))
            .chain(defaults.map(Decl::ImportDefault))
            .chain(namespaces.map(Decl::ImportNamespace))
            .chain(import_equals.map(Decl::ImportEquals))
            .next()
    }

    #[track_caller]
    fn symbol(&self, name: &str) -> Option<BuiltinPath> {
        let Some(decl) = self.find_declaration(name) else {
            panic!("no declaration of `{name}` in: {}", self.source);
        };
        self.resolved.of_symbol(self.bound.declared_symbol(decl))
    }

    #[track_caller]
    fn symbol_id(&self, name: &str) -> Option<BuiltinId> {
        self.symbol(name).map(|path| path.id)
    }

    fn mentions(&self, id: BuiltinId) -> bool {
        self.resolved.mentioned().contains(&id)
    }

    fn exposes(&self, id: BuiltinId) -> bool {
        self.resolved.exposed().contains(&id)
    }
}

#[track_caller]
fn assert_builtin(case: &Case<'_, '_>, text: &str, id: BuiltinId) {
    assert_eq!(case.builtin(text), Some(id), "`{text}` in: {}", case.source);
}

#[track_caller]
fn assert_unresolved(case: &Case<'_, '_>, text: &str) {
    let resolved = case.resolved_at(case.expr(text));
    assert!(
        resolved.is_none(),
        "`{text}` is {resolved:?} in: {}",
        case.source
    );
}

#[track_caller]
fn assert_mutability(case: &Case<'_, '_>, text: &str, mutability: Mutability) {
    let found = case.path(text).map(|path| path.mutability);
    assert_eq!(found, Some(mutability), "`{text}` in: {}", case.source);
}

#[track_caller]
fn find_name(text: &str) -> BuiltinName {
    table::find_name(text.as_bytes()).unwrap_or_else(|| panic!("`{text}` is not in the name table"))
}

#[track_caller]
fn find_member(holder: BuiltinId, name: &str) -> Option<BuiltinId> {
    match table::member(holder, find_name(name)) {
        MemberLookup::Found(member) => Some(table::canonical_id(member)),
        MemberLookup::Unknown | MemberLookup::Absent => None,
    }
}

fn jsc_namespace() -> BuiltinId {
    table::namespace_of(RuntimeModule::BunJsc)
}

fn jsc_heap_stats() -> BuiltinId {
    find_member(jsc_namespace(), "heapStats").expect("bun:jsc exports heapStats")
}

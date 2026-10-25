#![allow(dead_code, unused_imports)]

pub(crate) use bun_sema::atom::{Atom, Interner, known};
pub(crate) use bun_sema::bind::*;
pub(crate) use bun_sema::erasure::find_type_ranges;
pub(crate) use bun_sema::file_analysis::{FileAnalysis, FileInputs, analyze_file};
pub(crate) use bun_sema::fold::{
    Constant, Decision, Decisions, Define, DefinePath, DefineRoot, DefineValue, FoldError,
    FoldErrorKind, FoldInputs, FoldOptions, FoldedData, FoldedValue, RuntimeValueKind,
    data_value_of,
};
pub(crate) use bun_sema::hir::*;
pub(crate) use bun_sema::hir_from_data::{
    DataModule, DataModuleTree, DataValue, HostValue, module_from_data,
};
pub(crate) use bun_sema::import_sites::{
    AutomaticJsx, ImportSite, ImportSiteKind, ImportSpecifier, JsxCallee, JsxImport, JsxImportSet,
    JsxMode, find_key_attribute, is_ignored_key, jsx_callee, jsx_children, macro_callee,
};
pub(crate) use bun_sema::module_format::{CommonJsEvidence, DeclaredModuleType, ModuleFormat};
pub(crate) use bun_sema::session::{Arena, Session};
pub(crate) use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use bun_sema_standalone::{for_each_parallel, native};
use bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;
use std::borrow::Cow;
use std::path::PathBuf;

const STACK_SIZE: usize = DEFAULT_THREAD_STACK_SIZE as usize;
const STACK_RESERVE: usize = 256 << 10;
const MIN_PROGRAM_COUNT: usize = 1_000;
const MAX_FOLDED_STRING_BYTES: usize = 1 << 16;
const DECLARATION_EXTENSIONS: [&str; 3] = [".d.ts", ".d.mts", ".d.cts"];

pub(crate) const TYPESCRIPT_EXTENSIONS: [&str; 4] = [".ts", ".tsx", ".mts", ".cts"];
pub(crate) const JAVASCRIPT_EXTENSIONS: [&str; 4] = [".js", ".jsx", ".mjs", ".cjs"];
pub(crate) const SOURCE_EXTENSIONS: [&str; 8] =
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

#[derive(Copy, Clone)]
pub(crate) struct Workspace<'s> {
    pub(crate) atoms: Interner<'s>,
    pub(crate) arena: &'s Arena,
}

#[derive(Copy, Clone)]
pub(crate) struct Source<'a> {
    pub(crate) path: &'a str,
    pub(crate) text: &'a [u8],
    pub(crate) experimental_decorators: bool,
    pub(crate) reads_jsdoc: bool,
    pub(crate) runtime: RuntimeBindOptions,
    pub(crate) declared_module_type: Option<DeclaredModuleType>,
    pub(crate) import_meta_main: Option<bool>,
    pub(crate) is_library: bool,
    pub(crate) jsx: JsxMode,
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum Path<'a> {
    Global(&'a [&'a str]),
    ImportMeta(&'a [&'a str]),
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum Data<'a> {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(&'a str),
    BigInt(&'a str),
    Array(&'a [Data<'a>]),
    Object(&'a [(&'a str, Data<'a>)]),
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum Defined<'a> {
    Value(Data<'a>),
    GlobalPath(&'a [&'a str]),
    RuntimeValue(RuntimeValueKind),
}

#[derive(Copy, Clone)]
pub(crate) struct Fold<'a> {
    pub(crate) defines: &'a [(Path<'a>, Defined<'a>)],
    pub(crate) dropped_calls: &'a [Path<'a>],
    pub(crate) features: &'a [&'a str],
    pub(crate) preserves_unused_imports: bool,
    pub(crate) max_string_bytes: usize,
}

impl Fold<'static> {
    pub(crate) const NONE: Fold<'static> = Fold {
        defines: &[],
        dropped_calls: &[],
        features: &[],
        preserves_unused_imports: false,
        max_string_bytes: MAX_FOLDED_STRING_BYTES,
    };
}

impl Default for Fold<'_> {
    fn default() -> Self {
        Fold::NONE
    }
}

pub(crate) struct Analyzed<'s> {
    pub(crate) workspace: Workspace<'s>,
    pub(crate) hir: File<'s>,
    pub(crate) bound: Bound<'s>,
    pub(crate) analysis: FileAnalysis<'s>,
}

impl<'a> Source<'a> {
    pub(crate) fn new(path: &'a str, text: &'a str) -> Source<'a> {
        Source::from_bytes(path, text.as_bytes())
    }

    pub(crate) fn from_bytes(path: &'a str, text: &'a [u8]) -> Source<'a> {
        Source {
            path,
            text,
            experimental_decorators: false,
            reads_jsdoc: true,
            runtime: RuntimeBindOptions::default(),
            declared_module_type: None,
            import_meta_main: None,
            is_library: false,
            jsx: JsxMode::Classic,
        }
    }
}

pub(crate) fn with_workspace(test: impl for<'s> FnOnce(&Workspace<'s>) + Send) {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(scope, move || {
                native::set_stack_size(STACK_SIZE - STACK_RESERVE);
                let session = Session::new();
                let workspace = Workspace {
                    atoms: Interner::new_in(&session),
                    arena: session.arena(),
                };
                test(&workspace);
            })
            .unwrap();
    });
}

pub(crate) fn analyzed(path: &str, text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    analyzed_source(&Source::new(path, text), test);
}

pub(crate) fn analyzed_source(
    source: &Source<'_>,
    test: impl for<'s> FnOnce(&Analyzed<'s>) + Send,
) {
    with_workspace(|workspace| {
        let fold = workspace.fold_inputs(&Fold::NONE);
        test(&workspace.analyze(source, &fold));
    });
}

pub(crate) fn bind_options(runtime: Option<RuntimeBindOptions>) -> BindOptions {
    BindOptions {
        emit_standard_class_fields: true,
        runtime,
        ..Default::default()
    }
}

pub(crate) fn declared_module_type_of(path: &str) -> DeclaredModuleType {
    if path.ends_with(".cjs") || path.ends_with(".cts") {
        DeclaredModuleType::CommonJs
    } else if path.ends_with(".mjs") || path.ends_with(".mts") {
        DeclaredModuleType::Esm
    } else {
        DeclaredModuleType::Unknown
    }
}

pub(crate) fn find_exprs(hir: &File<'_>, test: impl Fn(&ExprKind) -> bool) -> Vec<ExprId> {
    find_ids(&hir.exprs, |expr| test(&expr.kind)).collect()
}

pub(crate) fn find_stmts(hir: &File<'_>, test: impl Fn(&StmtKind) -> bool) -> Vec<StmtId> {
    find_ids(&hir.stmts, |stmt| test(&stmt.kind)).collect()
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

pub(crate) fn symbols_of(bound: &Bound<'_>) -> impl Iterator<Item = SymbolId> {
    (0..bound.symbols.len() as u32).map(SymbolId)
}

pub(crate) fn describe_runtime(bound: &Bound<'_>) -> String {
    let runtime = &bound.runtime;
    let describe_symbol = |symbol: SymbolId| {
        (
            bound.binding_kind(symbol),
            bound.binding_stability(symbol),
            bound.initial_state(symbol),
            bound.symbol_scope(symbol),
            bound.has_runtime_value(symbol),
            bound.is_visible_to_eval(symbol),
        )
    };
    let symbols: Vec<_> = symbols_of(bound).map(describe_symbol).collect();
    let described = (
        runtime.stores(),
        runtime.unbound_name_stores(),
        runtime.annex_b_functions(),
        runtime.parameter_var_copies(),
        runtime.implicit_references(),
        runtime.redeclared_commonjs_variables(),
        runtime.eval_scopes(),
        runtime.early_redeclarations(),
        runtime.private_names(),
        bound.ident_bindings(),
        symbols,
    );
    format!("{described:?}")
}

pub(crate) fn repository_path(relative: &str) -> PathBuf {
    std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../..")).join(relative)
}

#[allow(clippy::disallowed_methods)]
pub(crate) fn read_file(path: &std::path::Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

pub(crate) fn for_each_program(
    extensions: &[&str],
    test: impl for<'s> Fn(&Workspace<'s>, &str, &[u8]) + Sync,
) {
    let files = find_programs(extensions);
    assert!(
        files.len() >= MIN_PROGRAM_COUNT,
        "only {} programs have one of the extensions {extensions:?}",
        files.len()
    );
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
    for_each_parallel(threads, files.len(), |index| {
        let path = files[index].as_str();
        let Some(text) = read_file(std::path::Path::new(path)) else {
            panic!("{path} cannot be read");
        };
        let workspace = Workspace {
            atoms,
            arena: session.arena(),
        };
        test(&workspace, path, &text);
    });
}

#[allow(clippy::disallowed_methods)]
fn find_programs(extensions: &[&str]) -> Vec<String> {
    let mut files = Vec::new();
    let mut directories = vec![repository_path("test/aot/programs")];
    while let Some(directory) = directories.pop() {
        let entries = std::fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("{}: {error}", directory.display()));
        for entry in entries {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                directories.push(entry.path());
                continue;
            }
            let path = entry.path().into_os_string().into_string().unwrap();
            let has_extension = |extension: &&str| path.ends_with(*extension);
            let is_requested = extensions.iter().any(has_extension);
            let is_declaration = DECLARATION_EXTENSIONS.iter().any(has_extension);
            if is_requested && !is_declaration {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

impl<'s> Workspace<'s> {
    pub(crate) fn atom(&self, text: &str) -> Atom {
        self.atoms.intern(text.as_bytes())
    }

    pub(crate) fn text(&self, atom: Atom) -> &str {
        if atom.is_none() {
            return "<none>";
        }
        std::str::from_utf8(self.atoms.bytes(atom)).unwrap()
    }

    pub(crate) fn parse(&self, source: &Source<'_>) -> File<'s> {
        let options = CompileParseOptions {
            path: source.path.as_bytes(),
            script_kind: None,
            experimental_decorators: source.experimental_decorators,
            every_file_is_a_module: false,
            reads_jsdoc: source.reads_jsdoc,
            keeps_function_directives: false,
        };
        let mut hir = parse_for_compile(self.arena, &options, source.text, &self.atoms);
        hir.text = Cow::Borrowed(self.arena.alloc_slice_copy(source.text));
        hir
    }

    pub(crate) fn data(&self, value: &Data<'_>) -> &'s DataValue<'s> {
        self.arena.alloc(self.data_value(value))
    }

    pub(crate) fn host_data(&self, value: &Data<'_>) -> HostValue<'s> {
        HostValue::Data(self.data(value))
    }

    pub(crate) fn automatic_jsx(&self, is_development: bool) -> JsxMode {
        let runtime = if is_development {
            "react/jsx-dev-runtime"
        } else {
            "react/jsx-runtime"
        };
        JsxMode::Automatic(AutomaticJsx {
            runtime_specifier: self.atom(runtime),
            package_specifier: self.atom("react"),
            is_development,
        })
    }

    pub(crate) fn describe_data(&self, value: &DataValue<'_>) -> String {
        match *value {
            DataValue::Undefined => "undefined".to_owned(),
            DataValue::Null => "null".to_owned(),
            DataValue::Boolean(value) => value.to_string(),
            DataValue::Number(value) => value.to_string(),
            DataValue::String(text) => format!("{:?}", self.text(text)),
            DataValue::BigInt(digits) => format!("{}n", self.text(digits)),
            DataValue::Array(elements) => {
                let elements: Vec<String> = elements
                    .iter()
                    .map(|element| self.describe_data(element))
                    .collect();
                format!("[{}]", elements.join(","))
            }
            DataValue::Object(properties) => {
                let properties: Vec<String> = properties
                    .iter()
                    .map(|(key, value)| {
                        format!("{:?}:{}", self.text(*key), self.describe_data(value))
                    })
                    .collect();
                format!("{{{}}}", properties.join(","))
            }
        }
    }

    pub(crate) fn fold_inputs(&self, fold: &Fold<'_>) -> FoldInputs<'s> {
        let options = FoldOptions {
            defines: self.map_slice(fold.defines, |&(path, value)| Define {
                path: self.define_path(path),
                value: self.define_value(value),
            }),
            dropped_calls: self.map_slice(fold.dropped_calls, |&path| self.define_path(path)),
            features: self.intern_all(fold.features),
            preserves_unused_imports: fold.preserves_unused_imports,
            max_string_bytes: fold.max_string_bytes,
        };
        FoldInputs::new(options, self.arena)
    }

    pub(crate) fn analyze(&self, source: &Source<'_>, fold: &FoldInputs<'s>) -> Analyzed<'s> {
        let mut hir = self.parse(source);
        let (bound, analysis) = self.analyze_tree(&mut hir, source, fold, &[]);
        Analyzed {
            workspace: *self,
            hir,
            bound,
            analysis,
        }
    }

    pub(crate) fn analyze_tree(
        &self,
        hir: &mut File<'s>,
        source: &Source<'_>,
        fold: &FoldInputs<'s>,
        host_values: &[(ExprId, HostValue<'s>)],
    ) -> (Bound<'s>, FileAnalysis<'s>) {
        let options = bind_options(Some(source.runtime));
        let file = FileInputs {
            declared_module_type: source
                .declared_module_type
                .unwrap_or_else(|| declared_module_type_of(source.path)),
            import_meta_main: source.import_meta_main,
            is_library: source.is_library,
            host_values: self.arena.alloc_slice_copy(host_values),
            jsx: source.jsx,
        };
        analyze_file(hir, options, fold, file, &self.atoms, self.arena)
    }

    #[track_caller]
    pub(crate) fn ident(&self, hir: &File<'s>, name: &str, nth: usize) -> ExprId {
        let atom = self.atom(name);
        let is_match = |expr: &Expr| matches!(expr.kind, ExprKind::Ident(text) if text == atom);
        let found = find_ids(&hir.exprs, is_match).nth(nth);
        self.expect_node(found, "identifier", name, nth)
    }

    #[track_caller]
    pub(crate) fn pat(&self, hir: &File<'s>, name: &str, nth: usize) -> PatId {
        let atom = self.atom(name);
        let is_match = |pat: &Pat| matches!(pat.kind, PatKind::Ident(text) if text == atom);
        let found = find_ids(&hir.pats, is_match).nth(nth);
        self.expect_node(found, "identifier pattern", name, nth)
    }

    #[track_caller]
    pub(crate) fn function(&self, hir: &File<'s>, name: &str) -> FnId {
        let atom = self.atom(name);
        let found = find_ids(&hir.fns, |func| func.name == atom && has_body(func)).next();
        self.expect_node(found, "function with a body", name, 0)
    }

    #[track_caller]
    pub(crate) fn class(&self, hir: &File<'s>, name: &str) -> ClassId {
        let atom = self.atom(name);
        let found = find_ids(&hir.classes, |class| class.name == atom).next();
        self.expect_node(found, "class", name, 0)
    }

    #[track_caller]
    fn expect_node<Id>(&self, found: Option<Id>, kind: &str, name: &str, nth: usize) -> Id {
        match found {
            Some(id) => id,
            None => panic!("no {kind} `{name}` number {nth}"),
        }
    }

    fn map_slice<T, U: Copy>(&self, items: &[T], convert: impl FnMut(&T) -> U) -> &'s [U] {
        self.arena.alloc_slice_fill_iter(items.iter().map(convert))
    }

    fn intern_all(&self, names: &[&str]) -> &'s [Atom] {
        self.map_slice(names, |name| self.atom(name))
    }

    fn data_value(&self, value: &Data<'_>) -> DataValue<'s> {
        match *value {
            Data::Undefined => DataValue::Undefined,
            Data::Null => DataValue::Null,
            Data::Boolean(value) => DataValue::Boolean(value),
            Data::Number(value) => DataValue::Number(value),
            Data::String(text) => DataValue::String(self.atom(text)),
            Data::BigInt(digits) => DataValue::BigInt(self.atom(digits)),
            Data::Array(elements) => {
                let elements = self.map_slice(elements, |element| self.data_value(element));
                DataValue::Array(elements)
            }
            Data::Object(properties) => {
                let properties = self.map_slice(properties, |(key, value)| {
                    (self.atom(key), self.data_value(value))
                });
                DataValue::Object(properties)
            }
        }
    }

    fn define_path(&self, path: Path<'_>) -> DefinePath<'s> {
        let (root, members) = match path {
            Path::Global([]) => panic!("a global path starts with a name"),
            Path::Global([root, members @ ..]) => (DefineRoot::Global(self.atom(root)), members),
            Path::ImportMeta(members) => (DefineRoot::ImportMeta, members),
        };
        DefinePath {
            root,
            members: self.intern_all(members),
        }
    }

    fn define_value(&self, value: Defined<'_>) -> DefineValue<'s> {
        match value {
            Defined::GlobalPath(names) => DefineValue::GlobalPath(self.intern_all(names)),
            Defined::RuntimeValue(kind) => DefineValue::RuntimeValue(kind),
            Defined::Value(data) => match data {
                Data::Undefined => DefineValue::Constant(Constant::Undefined),
                Data::Null => DefineValue::Constant(Constant::Null),
                Data::Boolean(value) => DefineValue::Constant(Constant::Boolean(value)),
                Data::Number(value) => DefineValue::Constant(Constant::Number(value)),
                Data::String(text) => DefineValue::Constant(Constant::String(self.atom(text))),
                Data::BigInt(digits) => DefineValue::Constant(Constant::BigInt(self.atom(digits))),
                Data::Array(_) | Data::Object(_) => DefineValue::Data(self.data(&data)),
            },
        }
    }
}

impl Analyzed<'_> {
    #[track_caller]
    pub(crate) fn ident(&self, name: &str, nth: usize) -> ExprId {
        self.workspace.ident(&self.hir, name, nth)
    }

    #[track_caller]
    pub(crate) fn pat(&self, name: &str, nth: usize) -> PatId {
        self.workspace.pat(&self.hir, name, nth)
    }

    #[track_caller]
    pub(crate) fn function(&self, name: &str) -> FnId {
        self.workspace.function(&self.hir, name)
    }

    #[track_caller]
    pub(crate) fn class(&self, name: &str) -> ClassId {
        self.workspace.class(&self.hir, name)
    }

    #[track_caller]
    pub(crate) fn binding(&self, name: &str, nth: usize) -> Binding {
        self.bound.binding(self.ident(name, nth))
    }

    #[track_caller]
    pub(crate) fn variable(&self, name: &str, nth: usize) -> SymbolId {
        self.bound.declared_symbol(Decl::Var(self.pat(name, nth)))
    }
}

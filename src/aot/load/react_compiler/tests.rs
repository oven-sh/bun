mod output;
mod types;
mod unchanged;

use std::borrow::Cow;

use bun_sema::atom::Atom;
use bun_sema::bind::{BindOptions, Bound, Parent, RuntimeBindOptions};
use bun_sema::file_analysis::{FileAnalysis, FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{
    BinOp, CallId, ExprId, ExprKind, File, FnBody, FnId, PatId, PatKind, StmtId, StmtKind, VarDecl,
};
use bun_sema::hir_from_data::HostValue;
use bun_sema::import_sites::{AutomaticJsx, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{JsxSettings, TranspileSettings};
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::*;
use crate::compile::LoadedProject;
use crate::compile::testing::{default_settings, with_loaded_build_and_react_compiler};
use crate::load::ProjectId;
use crate::load::sources::parsed_source;

const MAIN_PATH: &[u8] = b"/project/main.tsx";
const COMPILER_RUNTIME: &str = "react/compiler-runtime";
const DEVELOPMENT_RUNTIME: &str = "react/jsx-dev-runtime";
const PRODUCTION_RUNTIME: &str = "react/jsx-runtime";
const CACHE_FUNCTION: &str = "%react:import:_c";
const CACHE_IMPORT: &str = "c as %react:import:_c";
const HELLO: &str = "export function Hello({ name }: { name: string }) {\n\
                     return <div>Hello {name}</div>;\n\
                     }\n";
const UNTYPED_HELLO: &str = "export function Hello({ name }) {\n\
                             return <div>Hello {name}</div>;\n\
                             }\n";
const RULE: &str = "export function Rule() { return <hr />; }\n";

fn settings_with_jsx(jsx: JsxSettings) -> TranspileSettings {
    TranspileSettings {
        jsx,
        ..default_settings()
    }
}

fn production_settings() -> TranspileSettings {
    settings_with_jsx(JsxSettings {
        is_development: false,
        ..JsxSettings::default()
    })
}

struct Tree<'s> {
    files: &'s Files<'s>,
    file: FileId,
}

impl<'s> Tree<'s> {
    fn new(project: &LoadedProject<'_, 's>, name: &str) -> Tree<'s> {
        let files = project.loaded.files();
        let file = files.by_path.get(format!("/project/{name}").as_bytes());
        Tree {
            files,
            file: file.unwrap_or_else(|| panic!("{name} is not in the program")),
        }
    }

    fn hir(&self) -> &'s File<'s> {
        self.files.hir(self.file)
    }

    fn text(&self, atom: Atom) -> &'s [u8] {
        self.files.atoms.bytes(atom)
    }

    fn name_text(&self, atom: Atom) -> String {
        BStr::new(self.text(atom)).to_string()
    }

    fn has_compiled_components(&self) -> bool {
        let source = parsed_source(self.files, self.file);
        source
            .expect("a compiled file has a payload")
            .has_compiled_components
    }

    fn top_level_statements(&self) -> Vec<StmtId> {
        self.hir().ids(self.hir().body).collect()
    }

    fn reachable_expressions(&self) -> impl Iterator<Item = ExprId> {
        let bound = self.files.bound(self.file);
        let ids = (0..self.hir().exprs.len() as u32).map(ExprId);
        ids.filter(move |&expression| bound.parent_of_expr(expression) != Parent::None)
    }

    fn reachable_statements(&self) -> impl Iterator<Item = StmtId> {
        let bound = self.files.bound(self.file);
        let ids = (0..self.hir().stmts.len() as u32).map(StmtId);
        ids.filter(move |&statement| bound.parent_of_stmt(statement) != Parent::None)
    }

    fn count_expressions(&self, is_counted: impl Fn(ExprKind) -> bool) -> usize {
        let hir = self.hir();
        let expressions = self.reachable_expressions();
        expressions
            .filter(|&expression| is_counted(hir[expression].kind))
            .count()
    }

    fn count_jsx_elements(&self) -> usize {
        self.count_expressions(|kind| matches!(kind, ExprKind::Jsx(_)))
    }

    fn is_name(&self, expression: ExprId, name: &str) -> bool {
        matches!(
            self.hir()[expression].kind,
            ExprKind::Ident(written) if self.text(written) == name.as_bytes()
        )
    }

    fn count_names(&self, name: &str) -> usize {
        let expressions = self.reachable_expressions();
        expressions
            .filter(|&expression| self.is_name(expression, name))
            .count()
    }

    fn is_cache_slot(&self, expression: ExprId) -> bool {
        matches!(
            self.hir()[expression].kind,
            ExprKind::Index { obj, .. } if self.is_name(obj, "$")
        )
    }

    fn count_cache_writes(&self) -> usize {
        self.count_expressions(|kind| {
            matches!(kind, ExprKind::Assign { op: None, target, .. } if self.is_cache_slot(target))
        })
    }

    fn count_cache_comparisons(&self, operator: BinOp) -> usize {
        self.count_expressions(|kind| {
            matches!(
                kind,
                ExprKind::Binary { op, left, .. } if op == operator && self.is_cache_slot(left)
            )
        })
    }

    fn calls_of(&self, callee_name: &str) -> Vec<CallId> {
        let hir = self.hir();
        let calls = self
            .reachable_expressions()
            .filter_map(|it| match hir[it].kind {
                ExprKind::Call(call) => Some(call),
                _ => None,
            });
        calls
            .filter(|&call| self.is_name(hir[call].callee, callee_name))
            .collect()
    }

    fn member_path(&self, mut expression: ExprId) -> Vec<String> {
        let mut names = Vec::new();
        while let ExprKind::Dot { obj, name, .. } = self.hir()[expression].kind {
            names.push(self.name_text(name));
            expression = obj;
        }
        if let ExprKind::Ident(root) = self.hir()[expression].kind {
            names.push(self.name_text(root));
        }
        names.reverse();
        names
    }

    fn imports_from(&self, specifier: &str) -> Vec<hir::Import> {
        let hir = self.hir();
        let imports = self
            .top_level_statements()
            .into_iter()
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Import(import) => Some(hir[import]),
                _ => None,
            });
        imports
            .filter(|import| self.text(import.spec) == specifier.as_bytes())
            .collect()
    }

    fn imported_names(&self, specifier: &str) -> Vec<String> {
        let hir = self.hir();
        let imports = self.imports_from(specifier).into_iter();
        let mut names: Vec<String> = imports
            .flat_map(|import| import.named.iter())
            .map(|item| {
                let (imported, local) = (hir[item].imported, hir[item].local);
                format!("{} as {}", self.name_text(imported), self.name_text(local))
            })
            .collect();
        names.sort_unstable();
        names
    }

    fn pattern_name(&self, pattern: PatId) -> Option<String> {
        match self.hir()[pattern].kind {
            PatKind::Ident(name) => Some(self.name_text(name)),
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => None,
        }
    }

    fn declaration_named(&self, name: &str) -> VarDecl {
        let mut declarations = self.hir().var_decls.iter();
        let found = declarations
            .find(|declaration| self.pattern_name(declaration.pat).as_deref() == Some(name));
        *found.unwrap_or_else(|| panic!("nothing declares {name}"))
    }

    fn function_named(&self, name: &str) -> FnId {
        let hir = self.hir();
        let mut functions = (0..hir.fns.len() as u32).map(FnId);
        let found = functions.find(|&function| {
            let written = hir[function].name;
            written.is_some() && self.text(written) == name.as_bytes()
        });
        found.unwrap_or_else(|| panic!("no function is named {name}"))
    }

    fn wrapped_function(&self, variable_name: &str) -> FnId {
        let hir = self.hir();
        let ExprKind::Call(call) = hir[self.declaration_named(variable_name).init].kind else {
            panic!("{variable_name} is not initialized with a call");
        };
        let ExprKind::Fn(function) = hir[hir.id_at(hir[call].args, 0)].kind else {
            panic!("the first argument is not a function");
        };
        function
    }

    fn body_of(&self, function: FnId) -> Vec<StmtId> {
        match self.hir()[function].body {
            FnBody::Block(statements) => self.hir().ids(statements).collect(),
            FnBody::None | FnBody::Expr(_) => Vec::new(),
        }
    }

    fn cache_size(&self, function: FnId) -> Option<f64> {
        let hir = self.hir();
        let mut body = self.body_of(function).into_iter();
        let first = body.find(|&it| !matches!(hir[it].kind, StmtKind::Directive { .. }))?;
        let StmtKind::Var(declarations) = hir[first].kind else {
            return None;
        };
        let declaration = hir[declarations.at(0)];
        if self.pattern_name(declaration.pat).as_deref() != Some("$") {
            return None;
        }
        let ExprKind::Call(call) = hir[declaration.init.some()?].kind else {
            return None;
        };
        if !self.is_name(hir[call].callee, CACHE_FUNCTION) {
            return None;
        }
        let ExprKind::Number(size) = hir[hir.id_at(hir[call].args, 0)].kind else {
            return None;
        };
        Some(hir.numbers[size as usize])
    }

    fn sentinel_key(&self, name: &str) -> Option<String> {
        let hir = self.hir();
        let mut declarations = self
            .top_level_statements()
            .into_iter()
            .filter_map(|statement| match hir[statement].kind {
                StmtKind::Var(declarations) => Some(hir[declarations.at(0)]),
                _ => None,
            });
        let declaration = declarations
            .find(|declaration| self.pattern_name(declaration.pat).as_deref() == Some(name))?;
        let ExprKind::Call(call) = hir[declaration.init].kind else {
            return None;
        };
        if self.member_path(hir[call].callee) != ["globalThis", "Symbol", "for"] {
            return None;
        }
        let ExprKind::String(key) = hir[hir.id_at(hir[call].args, 0)].kind else {
            return None;
        };
        Some(self.name_text(key))
    }
}

fn with_project<R>(
    files: &[(&str, &str)],
    settings: &TranspileSettings,
    mode: ReactCompilerMode,
    then: impl for<'b, 's> FnOnce(&LoadedProject<'b, 's>) -> R,
) -> R {
    with_loaded_build_and_react_compiler(files, settings, mode, |_, loaded| {
        then(loaded.project(ProjectId::Application))
    })
}

fn with_tree<R>(
    name: &str,
    text: &str,
    mode: ReactCompilerMode,
    then: impl for<'s> FnOnce(&Tree<'s>) -> R,
) -> R {
    with_project(&[(name, text)], &default_settings(), mode, |project| {
        then(&Tree::new(project, name))
    })
}

fn with_tree_and_settings<R>(
    text: &str,
    settings: &TranspileSettings,
    then: impl for<'s> FnOnce(&Tree<'s>) -> R,
) -> R {
    with_project(
        &[("main.tsx", text)],
        settings,
        ReactCompilerMode::Client,
        |project| then(&Tree::new(project, "main.tsx")),
    )
}

fn with_compiled_tree<R>(text: &str, then: impl for<'s> FnOnce(&Tree<'s>) -> R) -> R {
    with_tree("main.tsx", text, ReactCompilerMode::Client, then)
}

struct Workbench<'s> {
    arena: &'s Arena,
    atoms: Interner<'s>,
    fold: FoldInputs<'s>,
    settings: TranspileSettings,
    tree: File<'s>,
}

impl<'s> Workbench<'s> {
    fn analyze(
        &mut self,
        host_values: &'s [(ExprId, HostValue<'s>)],
    ) -> (Bound<'s>, FileAnalysis<'s>) {
        let jsx = &self.settings.jsx;
        let file = FileInputs {
            declared_module_type: DeclaredModuleType::Unknown,
            import_meta_main: None,
            is_library: false,
            host_values,
            jsx: JsxMode::Automatic(AutomaticJsx {
                runtime_specifier: self.atoms.intern(&jsx.runtime_specifier()),
                package_specifier: self.atoms.intern(&jsx.import_source),
                is_development: jsx.is_development,
            }),
        };
        let bind_options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        analyze_file(
            &mut self.tree,
            bind_options,
            &self.fold,
            file,
            &self.atoms,
            self.arena,
        )
    }

    fn transform(
        &mut self,
        mode: ReactCompilerMode,
        bound: &Bound<'s>,
        analysis: &FileAnalysis<'s>,
    ) -> (TreeChange, ParsedSource) {
        let messages = LoadMessages::default();
        let mut source = ParsedSource::new(SourceKind::Program, Loader::Tsx);
        let mut request = TransformRequest {
            path: MAIN_PATH,
            hir: &mut self.tree,
            bound,
            analysis,
            settings: &self.settings,
        };
        let compiler = ReactCompiler::new(mode, &messages);
        let change = compiler.transform(self.arena, &self.atoms, &mut request, &mut source);
        (change, source)
    }
}

fn with_workbench<R>(text: &str, then: impl for<'s> FnOnce(&mut Workbench<'s>) -> R) -> R {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let parse_options = CompileParseOptions {
        path: MAIN_PATH,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: true,
        keeps_function_directives: false,
    };
    let mut tree = parse_for_compile(arena, &parse_options, text.as_bytes(), &atoms);
    tree.text = Cow::Borrowed(text.as_bytes());
    let fold_options = FoldOptions {
        max_string_bytes: usize::MAX,
        ..FoldOptions::default()
    };
    then(&mut Workbench {
        arena,
        atoms,
        fold: FoldInputs::new(fold_options, arena),
        settings: default_settings(),
        tree,
    })
}

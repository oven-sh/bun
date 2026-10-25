#![cfg(not(miri))]

use super::*;
use crate::program::code_file::load_code_file;
use crate::program::code_test_host::{
    StatementsHost, TEXT_LOADER, TestBuild, with_compile_context,
};
use crate::resolve::{ProjectFile, ProjectFiles};

const LINK: &[u8] = b"/linked/";
const LINK_TARGET: &[u8] = b"/real/";
const ES2015_CONFIG: &str = "{ compilerOptions: { target: \"es2015\" } }";
const INSTALLED: &str = "/node_modules/pkg/index.js";
const REFERENCED_SOURCE: &str = "/referenced/a.ts";

const PROJECTS: &[(&str, &str)] = &[
    (
        "/main.ts",
        "import \"./packages/lib/index\"\n\
         import \"pkg\"\n\
         import \"dep\"\n\
         import \"./referenced/a\"",
    ),
    ("/packages/lib/tsconfig.json", ES2015_CONFIG),
    ("/packages/lib/index.ts", "import \"./util.js\""),
    ("/packages/lib/util.js", ""),
    ("/packages/lib/types.d.ts", ""),
    (INSTALLED, "a"),
    ("/node_modules/dep/index.js", ""),
    ("/referenced/tsconfig.json", ES2015_CONFIG),
    (REFERENCED_SOURCE, ""),
];

struct LinkedDirectory {
    is_case_sensitive: bool,
}

const CASE_SENSITIVE: LinkedDirectory = LinkedDirectory {
    is_case_sensitive: true,
};

const CASE_INSENSITIVE: LinkedDirectory = LinkedDirectory {
    is_case_sensitive: false,
};

impl Host for LinkedDirectory {
    fn read(&self, _path: &[u8]) -> Option<Cow<'static, [u8]>> {
        None
    }

    fn is_file(&self, _path: &[u8]) -> bool {
        false
    }

    fn is_dir(&self, _path: &[u8]) -> bool {
        false
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match path.strip_prefix(LINK) {
            Some(rest) => [LINK_TARGET, rest].concat(),
            None => path.to_vec(),
        }
    }

    fn list_dir(&self, _path: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        _arena: &'s Arena,
        _path: &[u8],
        _text: &[u8],
        _atoms: &Interner<'s>,
        _options: ParseOptions,
    ) -> hir::File<'s> {
        unreachable!("`is_same_file` parses no file")
    }

    fn parse_package_json(&self, _arena: &Arena, _text: &[u8]) -> Option<Json> {
        None
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

struct FinishedModule<'q, 's, 'r> {
    module: ArenaBox<'s, Module<'s>>,
    question: TypesQuestion<'q, 's, 'r>,
}

#[derive(PartialEq, Eq, Debug)]
struct ModuleResolver {
    path: String,
    is_of_program: bool,
    from: String,
}

fn module_resolver(path: &str, is_of_program: bool, from: &str) -> ModuleResolver {
    ModuleResolver {
        path: path.to_owned(),
        is_of_program,
        from: from.to_owned(),
    }
}

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_context<R>(
    host: &StatementsHost,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    with_compile_context(&TestBuild::new(host, &[]), test)
}

fn options_with_referenced_project() -> Options {
    let file = ProjectFile {
        project: 0,
        source: REFERENCED_SOURCE.into(),
        output_dts: Vec::new(),
    };
    let sources = [(REFERENCED_SOURCE.as_bytes().to_vec(), vec![file])];
    let referenced = Options {
        target: ScriptTarget::ES2022,
        ..Options::default()
    };
    Options {
        project_files: Some(Arc::new(ProjectFiles {
            sources: sources.into_iter().collect(),
            outputs: FxHashMap::default(),
        })),
        referenced_projects: [(0, 0)].into_iter().collect(),
        referenced_options: vec![referenced],
        use_case_sensitive_file_names: true,
        ..Options::default()
    }
}

fn with_projects<R>(test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R) -> R {
    let host = host_of(PROJECTS);
    let build = TestBuild {
        options: options_with_referenced_project(),
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_compile_context(&build, test)
}

fn target_of(path: &'static [u8]) -> CodeTarget<'static> {
    CodeTarget::of_path(path, HostLoader::default())
}

fn load<'s, 'r>(context: &CodeLoadContext<'_, 's, 'r>, path: &str) -> ParsedCodeFile<'s, 'r> {
    let path = context.resolver.keep(path.as_bytes());
    let target = CodeTarget::of_path(path, HostLoader::default());
    let text = context.host.read_source(path);
    load_code_file(context, context.session.arena(), target, text, false, &[])
}

fn load_types<'s, 'r>(context: &CodeLoadContext<'_, 's, 'r>, path: &str) -> Box<Loaded<'s, 'r>> {
    let key = LoadKey {
        path: context.resolver.keep(path.as_bytes()),
        loader: HostLoader::default(),
    };
    let arena = context.session.arena();
    context
        .answer_types_question(arena, key, load(context, path))
        .0
}

fn program_question<'q, 's, 'r>(
    context: &'q CodeLoadContext<'_, 's, 'r>,
    path: &'q [u8],
) -> TypesQuestion<'q, 's, 'r> {
    let (resolver, from) = context.resolver.redirect_for_resolution(path);
    TypesQuestion {
        resolver,
        from,
        project: referenced_project_options(context.options, resolver),
    }
}

fn ask<'q, 's, 'r>(
    context: &'q CodeLoadContext<'_, 's, 'r>,
    role: FileRole,
    path: &'q str,
) -> TypesQuestion<'q, 's, 'r> {
    let path = path.as_bytes();
    context.types_question(role, path, None, program_question(context, path))
}

fn finish_modules<'q, 's, 'r>(
    context: &'q CodeLoadContext<'_, 's, 'r>,
) -> Vec<FinishedModule<'q, 's, 'r>> {
    let arena = context.session.arena();
    let mut code_files = context.load_code_files(&|_| {}, &Default::default(), &mut || {});
    let count = code_files.entries.len() as u32;
    for (entry, file) in code_files.entries.iter_mut().zip(0..count) {
        entry.file = Some(FileId(file));
    }
    code_files.entry_of_file = (0..count).map(Some).collect();
    code_files.is_in_types_program = vec![true; count as usize];
    let mut finished = Vec::new();
    for file in (0..count).map(FileId) {
        let Some(loaded) = code_files.take_loaded(file) else {
            continue;
        };
        let Loaded { mut module, .. } = *loaded;
        let entry = &code_files.entries[file.idx()];
        let path = entry.key.path;
        let code = entry.code.lock();
        let current = program_question(context, path);
        let question = context.types_question(entry.role, path, code.as_deref(), current);
        drop(code);
        module.path = file_path(slice_in(path, arena), true, arena);
        code_files.finish_module(file, &mut module, arena);
        finished.push(FinishedModule { module, question });
    }
    finished
}

#[test]
fn link_and_target_are_same_file() {
    let real = target_of(b"/real/x.ts");
    assert!(is_same_file(&CASE_SENSITIVE, b"/real/x.ts", &real));
    assert!(is_same_file(&CASE_SENSITIVE, b"/linked/x.ts", &real));
    assert!(!is_same_file(&CASE_SENSITIVE, b"/linked/y.ts", &real));
    assert!(!is_same_file(&CASE_SENSITIVE, b"/real/x.d.ts", &real));

    let linked = target_of(b"/linked/x.ts");
    assert!(is_same_file(&CASE_SENSITIVE, b"/real/x.ts", &linked));
    assert!(!is_same_file(&CASE_SENSITIVE, b"/real/y.ts", &linked));
}

#[test]
fn case_counts_on_case_sensitive_file_system() {
    let real = target_of(b"/real/x.ts");
    assert!(!is_same_file(&CASE_SENSITIVE, b"/linked/X.ts", &real));
    assert!(is_same_file(&CASE_INSENSITIVE, b"/linked/X.ts", &real));
    assert!(!is_same_file(&CASE_INSENSITIVE, b"/linked/Y.ts", &real));
}

#[test]
fn other_loader_is_never_same_file() {
    let as_text = CodeTarget::of_path(b"/real/x.ts", TEXT_LOADER);
    assert!(!is_same_file(&CASE_SENSITIVE, b"/real/x.ts", &as_text));
    assert!(!is_same_file(&CASE_SENSITIVE, b"/linked/x.ts", &as_text));
}

#[test]
fn program_path_is_path_of_running_file() {
    let host = host_of(&[
        ("/real/a.ts", "import \"./lib.js\"\nimport \"./x\""),
        ("/real/lib.js", ""),
        ("/real/x.ts", ""),
    ]);
    with_context(&host, |context| {
        let code = load(context, "/real/a.ts").code;
        let program_path = |specifier: &[u8], found: &'static [u8]| {
            let key = (context.atoms.intern(specifier), ResolutionMode::None);
            code.program_path(&CASE_SENSITIVE, key, found)
        };
        assert_eq!(
            program_path(b"./lib.js", b"/linked/lib.js"),
            b"/real/lib.js"
        );
        assert_eq!(program_path(b"./x", b"/linked/x.ts"), b"/real/x.ts");
        assert_eq!(
            program_path(b"./lib.js", b"/real/lib.d.ts"),
            b"/real/lib.d.ts"
        );
        assert_eq!(program_path(b"./unknown", b"/linked/x.ts"), b"/linked/x.ts");
    });
}

#[test]
fn target_is_found_by_mode_then_by_other_kind() {
    let host = host_of(&[
        (
            "/p/a.js",
            "import \"./x\"\n\
             require(\"./x\")\n\
             import \"./imported.js\"\n\
             require(\"./required.js\")",
        ),
        ("/p/x.mjs", ""),
        ("/p/x.cjs", ""),
        ("/p/imported.js", ""),
        ("/p/required.js", ""),
    ]);
    with_context(&host, |context| {
        let code = load(context, "/p/a.js").code;
        let path_of = |specifier: &[u8], mode: ResolutionMode| {
            let target = code.find_target(context.atoms.intern(specifier), mode)?;
            Some(code.targets[target as usize].key.path.as_bstr().to_string())
        };
        assert_eq!(
            path_of(b"./x", ResolutionMode::Import).as_deref(),
            Some("/p/x.mjs")
        );
        assert_eq!(
            path_of(b"./x", ResolutionMode::None).as_deref(),
            Some("/p/x.mjs")
        );
        assert_eq!(
            path_of(b"./x", ResolutionMode::Require).as_deref(),
            Some("/p/x.cjs")
        );
        let modes = [
            ResolutionMode::None,
            ResolutionMode::Import,
            ResolutionMode::Require,
        ];
        for mode in modes {
            let imported = path_of(b"./imported.js", mode);
            assert_eq!(imported.as_deref(), Some("/p/imported.js"), "{mode:?}");
            let required = path_of(b"./required.js", mode);
            assert_eq!(required.as_deref(), Some("/p/required.js"), "{mode:?}");
            assert_eq!(path_of(b"./missing.js", mode), None, "{mode:?}");
        }
    });
}

#[test]
fn only_inferred_file_answers_types_from_code() {
    let host = host_of(&[("/p/a.js", "import \"./b.js\""), ("/p/b.js", "")]);
    with_context(&host, |context| {
        let mut code = load(context, "/p/a.js").code;
        let names = [(context.atoms.intern(b"./b.js"), ResolutionMode::None, true)];
        for role in [FileRole::Checked, FileRole::TypesOnly] {
            assert!(!code.answer_types_from_code(role, &names), "{role:?}");
            assert!(code.types_answers.is_empty(), "{role:?}");
        }
        assert!(code.answer_types_from_code(FileRole::Inferred, &names));
        assert_eq!(code.types_answers, [(names[0].0, ResolutionMode::None, 0)]);
    });
}

#[test]
fn inferred_file_answers_each_name_and_mode_once() {
    let host = host_of(&[
        ("/p/a.js", "import \"./x\"\nrequire(\"./x\")"),
        ("/p/x.mjs", ""),
        ("/p/x.cjs", ""),
    ]);
    with_context(&host, |context| {
        let mut code = load(context, "/p/a.js").code;
        let (x, missing) = (
            context.atoms.intern(b"./x"),
            context.atoms.intern(b"./missing"),
        );
        let names = [
            (x, ResolutionMode::Import, true),
            (missing, ResolutionMode::Import, true),
            (x, ResolutionMode::Require, true),
            (x, ResolutionMode::Import, false),
        ];
        assert!(code.answer_types_from_code(FileRole::Inferred, &names));
        let expected = [
            (x, ResolutionMode::Import, 0),
            (x, ResolutionMode::Require, 1),
        ];
        assert_eq!(code.types_answers, expected);
    });
}

#[test]
fn file_of_program_asks_program() {
    with_projects(|context| {
        let question = ask(context, FileRole::Checked, "/main.ts");
        assert!(std::ptr::eq(question.resolver, context.resolver));
        assert_eq!(question.from, b"/main.ts");
        assert!(question.project.is_none());
    });
}

#[test]
fn declaration_file_asks_program() {
    with_projects(|context| {
        let question = ask(context, FileRole::TypesOnly, "/packages/lib/types.d.ts");
        assert!(std::ptr::eq(question.resolver, context.resolver));
        assert_eq!(question.from, b"/packages/lib/types.d.ts");
        assert!(question.project.is_none());
    });
}

#[test]
fn governing_project_answers_for_typescript_and_javascript() {
    with_projects(|context| {
        let typescript = ask(context, FileRole::Checked, "/packages/lib/index.ts");
        let project = typescript
            .project
            .expect("the directory has a configuration file");
        assert_eq!(project.target, ScriptTarget::ES2015);
        assert!(!std::ptr::eq(typescript.resolver, context.resolver));
        assert!(std::ptr::eq(typescript.resolver.options(), project));
        assert_eq!(typescript.from, b"/packages/lib/index.ts");

        let javascript = ask(context, FileRole::Inferred, "/packages/lib/util.js");
        assert!(std::ptr::eq(javascript.resolver, typescript.resolver));
        assert!(
            javascript
                .project
                .is_some_and(|it| std::ptr::eq(it, project))
        );
        assert_eq!(javascript.from, b"/packages/lib/util.js");
    });
}

#[test]
fn referenced_project_answers_for_own_source() {
    with_projects(|context| {
        let referenced = &context.options.referenced_options[0];
        let question = ask(context, FileRole::Checked, REFERENCED_SOURCE);
        assert!(std::ptr::eq(question.resolver.options(), referenced));
        assert!(
            question
                .project
                .is_some_and(|it| std::ptr::eq(it, referenced))
        );
        assert_eq!(question.from, REFERENCED_SOURCE.as_bytes());
        let current = program_question(context, REFERENCED_SOURCE.as_bytes());
        assert!(std::ptr::eq(question.resolver, current.resolver));
    });
}

#[test]
fn module_resolver_agrees_with_types_question() {
    with_projects(|context| {
        let mut resolvers = Vec::new();
        for FinishedModule { module, question } in finish_modules(context) {
            let (resolver, from) =
                CodeLoadContext::resolver_of_module(Some(context), context.resolver, &module);
            let path = module.file_name().as_bstr().to_string();
            assert!(std::ptr::eq(resolver, question.resolver), "{path}");
            assert_eq!(from, question.from, "{path}");
            resolvers.push(ModuleResolver {
                path,
                is_of_program: std::ptr::eq(resolver, context.resolver),
                from: from.as_bstr().to_string(),
            });
        }
        let expected = [
            module_resolver("/packages/lib/util.js", false, "/packages/lib/util.js"),
            module_resolver("/packages/lib/index.ts", false, "/packages/lib/index.ts"),
            module_resolver(INSTALLED, false, INSTALLED),
            module_resolver(
                "/node_modules/dep/index.js",
                false,
                "/node_modules/dep/index.js",
            ),
            module_resolver(REFERENCED_SOURCE, false, REFERENCED_SOURCE),
            module_resolver("/main.ts", true, "/main.ts"),
        ];
        assert_eq!(resolvers, expected);
    });
}

#[test]
fn module_resolver_without_build_follows_project_references_only() {
    with_projects(|context| {
        for FinishedModule { module, .. } in finish_modules(context) {
            let (resolver, from) =
                CodeLoadContext::resolver_of_module(None, context.resolver, &module);
            let path = module.file_name();
            let is_referenced = path == REFERENCED_SOURCE.as_bytes();
            let is_of_program = std::ptr::eq(resolver, context.resolver);
            assert_eq!(is_of_program, !is_referenced, "{}", path.as_bstr());
            assert_eq!(from, path);
        }
    });
}

#[test]
fn referenced_options_are_found_by_address() {
    with_projects(|context| {
        let options = context.options;
        assert!(referenced_project_options(options, context.resolver).is_none());

        let source = REFERENCED_SOURCE.as_bytes();
        let (referenced, _) = context.resolver.redirect_for_resolution(source);
        let found = referenced_project_options(options, referenced);
        assert!(found.is_some_and(|it| std::ptr::eq(it, &options.referenced_options[0])));

        let governed = ask(context, FileRole::Checked, "/packages/lib/index.ts");
        assert!(referenced_project_options(options, governed.resolver).is_none());
    });
}

#[test]
fn declaration_file_is_parsed_with_options_of_program() {
    with_projects(|context| {
        let of_program = context.options.for_parsing();
        assert!(!of_program.bind.before_es2020);
        let parse_options = |path: &[u8]| context.types_file_parse_options(path);
        let as_module = ParseOptions {
            module_detection: ModuleDetection::Force,
            ..of_program
        };
        assert_eq!(parse_options(b"/main.ts"), as_module);
        assert_eq!(parse_options(b"/packages/lib/types.d.ts"), of_program);
        assert!(
            parse_options(b"/packages/lib/only-types.ts")
                .bind
                .before_es2020
        );
    });
}

#[test]
fn predicted_files_are_references_then_added_imports() {
    let host = host_of(&[
        (
            "/p/a.ts",
            "import \"./b\"\nimport \"./c.js\"\nimport \"pkg\"\nimport \"./missing\"",
        ),
        ("/p/b.ts", ""),
        ("/p/c.js", ""),
        ("/p/node_modules/pkg/index.js", ""),
    ]);
    let build = TestBuild {
        options: Options {
            allow_js: true,
            ..Options::default()
        },
        ..TestBuild::new(&host, &[])
    };
    with_compile_context(&build, |context| {
        let mut loaded = load_types(context, "/p/a.ts");
        let imports = [(&b"/p/b.ts"[..], false), (&b"/p/c.js"[..], false)];
        assert_eq!(predicted_type_files(context.host, &loaded), imports);

        let library = &b"/lib/lib.es5.d.ts"[..];
        loaded.references.push((library, true, false, None));
        let expected = [(library, true), imports[0], imports[1]];
        assert_eq!(predicted_type_files(context.host, &loaded), expected);
    });
}

#[test]
fn javascript_is_not_predicted_without_allow_js() {
    let host = host_of(&[
        ("/p/a.ts", "import \"./b\"\nimport \"./c.js\""),
        ("/p/b.ts", ""),
        ("/p/c.js", ""),
    ]);
    with_context(&host, |context| {
        let loaded = load_types(context, "/p/a.ts");
        assert_eq!(
            predicted_type_files(context.host, &loaded),
            [(&b"/p/b.ts"[..], false)]
        );
    });
}

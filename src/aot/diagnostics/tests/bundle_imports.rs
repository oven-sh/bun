use std::borrow::Cow;

use bun_alloc::Arena as AstArena;
use bun_ast::{ASTMemoryAllocator, Kind, Loader, Log, Source};
use bun_js_parser::{Define, Parser, ParserOptions};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::FoldOptions;
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::FileId;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::super::front_end::fold_error_diagnostic;
use super::text;
use crate::builtins::Platforms;
use crate::load::fold_inputs::create_application_fold_inputs;

const PATH: &[u8] = b"/project/a.ts";

/// One error: its text, where it points, and its note lines.
#[derive(PartialEq, Eq, Debug)]
struct Said {
    text: String,
    at: Option<usize>,
    notes: Vec<String>,
}

fn said_by_transpiler(source_text: &str) -> Vec<Said> {
    let arena = AstArena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    let options = ParserOptions::init(Default::default(), Loader::Ts);
    let source = Source::init_path_string(PATH, source_text.as_bytes());
    let define = Define::with_pure_globals(false, true);
    let mut log = Log::init();
    if let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena) {
        let _ = parser.parse();
    }
    let errors = log.msgs.iter().filter(|message| message.kind == Kind::Err);
    errors
        .map(|message| Said {
            text: text(&message.data.text),
            at: message.data.location.as_ref().map(|it| it.offset),
            notes: message.notes.iter().map(|note| text(&note.text)).collect(),
        })
        .collect()
}

fn said_by_build(source_text: &str) -> Vec<Said> {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let platform = Platforms::LINUX;
    let fold =
        create_application_fold_inputs(&FoldOptions::default(), arena, &atoms, platform, false);
    let parse_options = CompileParseOptions {
        path: PATH,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, source_text.as_bytes(), &atoms);
    hir.text = Cow::Owned(source_text.as_bytes().to_vec());
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
        own_name: b"",
    };
    let analysis = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena).1;
    let errors = analysis.errors.iter();
    errors
        .map(|error| {
            let diagnostic = fold_error_diagnostic(&hir, &atoms, FileId(0), error);
            let notes = diagnostic.related.iter();
            Said {
                text: text(&diagnostic.code.message(&diagnostic.arguments)),
                at: diagnostic.span.map(|span| span.start as usize),
                notes: notes
                    .map(|note| text(&note.code.message(&note.arguments)))
                    .collect(),
            }
        })
        .collect()
}

#[test]
fn a_bundle_import_gets_the_verdict_and_the_words_of_the_transpiler() {
    let clauses = [
        "d",
        "* as ns",
        "defer * as ns",
        "d, * as ns",
        "d, { feature }",
        "d, { type T }",
    ];
    let mut cells = Vec::new();
    for clause in clauses {
        for attribute in ["", " with { type: \"macro\" }"] {
            let statement = format!("import {clause} from \"bun:bundle\"{attribute};");
            cells.push(format!("{statement}\nexport {{}};\n"));
            cells.push(format!(
                "declare module \"x\" {{ {statement} }}\nexport {{}};\n"
            ));
        }
    }
    assert_eq!(cells.len(), 24);
    let mut refused = 0;
    for cell in &cells {
        let by_transpiler = said_by_transpiler(cell);
        assert_eq!(said_by_build(cell), by_transpiler, "{cell}");
        refused += usize::from(!by_transpiler.is_empty());
    }
    assert_eq!(refused, 12, "the cells without the macro attribute");

    let controls: [(&str, &[&str]); 4] = [
        (
            "import { nope } from \"bun:bundle\";",
            &["\"bun:bundle\" has no export named \"nope\""],
        ),
        ("import type * as B from \"bun:bundle\";", &[]),
        ("import {} from \"bun:bundle\";", &[]),
        ("import \"bun:bundle\";", &[]),
    ];
    for (statement, expected) in controls {
        let cell = format!("{statement}\nexport {{}};\n");
        let by_transpiler = said_by_transpiler(&cell);
        let texts: Vec<&str> = by_transpiler.iter().map(|said| &*said.text).collect();
        assert_eq!(texts, expected, "{cell}");
        assert_eq!(said_by_build(&cell), by_transpiler, "{cell}");
    }
}

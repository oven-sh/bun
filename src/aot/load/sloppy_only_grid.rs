//! The forms that only sloppy mode code has, and the legacy HTML comments that only a script has: the build refuses a text where the parser of `bun run`
//! refuses it, and nowhere else. A cell is a form in a place, in a file that is a module or strict mode code for one reason or for none, under one name.

use bun_alloc::Arena as AstArena;
use bun_ast::{ASTMemoryAllocator, Kind, Loader, Log, Source};
use bun_core::strings;
use bun_js_parser::{Define, Parser};
use bun_options_types::bundle_enums::ModuleType;

use super::parser_of_bun_run::parser_options_of_bun_run;
use crate::compile::testing::{default_settings, with_loaded_build};
use crate::diagnostics::Diagnostics;

/// A statement, and whether no reader refuses it anywhere.
#[rustfmt::skip]
const FORMS: &[(&str, bool)] = &[
    ("if (0) function f() {}", false),
    ("if (0) ; else function f() {}", false),
    ("l: function f() {}", false),
    ("for (var a = 1 in {}) {}", false),
    ("{ function f() {} function f() {} }", false),
    ("switch (0) { case 0: function f() {} break; case 1: function f() {} }", false),
    ("function f() {} function f() {}", false),
    ("var a = 1 <!-- b\n;", false),
    ("var a = 1;\n--> b\n;", false),
    ("/* a\n*/ --> b\n;", false),
    ("if (0) { function f() {} }", true),
    ("l: { function f() {} }", true),
    ("for (var a in {}) {}", true),
    ("{ function f() {} } { function f() {} }", true),
    ("var a = 2, b = 1; a --> b;", true),
    ("var a = \"<!--\", b = `\n-->`; // <!--\n/* --> */", true),
];

/// What stands in front of the form and behind it, in one file.
#[rustfmt::skip]
const PLACES: &[(&str, &str)] = &[
    ("", ""),
    ("{ ", " }"),
    ("if (1) { ", " }"),
    ("try { ", " } catch {}"),
    ("function g() { ", " }"),
    ("function g() { { ", " } }"),
    ("function g() { \"use strict\"; ", " }"),
    ("function g() { \"use strict\"; return function () { ", " }; }"),
    ("function g() { (\"use strict\"); ", " }"),
    ("(() => { ", " });"),
    ("({ m() { \"use strict\"; ", " } });"),
    ("({ [(() => { ", " })()]() { \"use strict\"; } });"),
    ("class A { m() { ", " } }"),
    ("class A { static { ", " } }"),
    ("class A { a = () => { ", " }; }"),
    ("class A extends (function () { ", " }) {}"),
    ("@(function () { ", " }) class A {}"),
    ("(@(function () { ", " }) class {});"),
    ("class A { @(function () { ", " }) m() {} }"),
];

/// A legacy HTML comment between two tokens of one construct, and the same construct with a comment that every reader knows. An early error of the
/// construct stays one with the mark in it.
#[rustfmt::skip]
const FORMS_WITH_A_MARK_INSIDE: &[(&str, bool)] = &[
    ("function f(...a <!-- b\n,) {}", false),
    ("function f(...a\n--> b\n,) {}", false),
    ("function f(...a /* b */\n,) {}", false),
    ("function f(... <!-- b\na, c) {}", false),
    ("function f(...\n--> b\na, c) {}", false),
    ("var b; [...b = <!-- b\n1] = [1];", false),
    ("var o = ({ a <!-- b\n= 1 });", false),
    ("var o = ({ a\n--> b\n= 1 });", false),
    ("function g() { for <!-- b\nawait (const a of []) {} }", false),
    ("function f <!-- <>\n() { return 1; }", false),
    ("function f\n--> <>\n() { return 1; }", false),
    ("function f(a <!-- b\n, c) {}", false),
    ("var o = ({ a /* b */\n: 1 });", true),
];

/// Where a form with a mark inside stands.
const PLACES_OF_A_MARK_INSIDE: &[(&str, &str)] = &[
    ("", ""),
    ("function h() { ", " }"),
    ("class A { m() { ", " } }"),
];

/// What a file has in front of the place and behind it: what can make it a module or strict mode code, and what looks like it.
#[rustfmt::skip]
const FILES: &[(&str, &str)] = &[
    ("", ""),
    ("\"use strict\"; ", ""),
    ("(\"use strict\"); ", ""),
    ("var first; \"use strict\"; ", ""),
    ("import \"./dep.mjs\"; ", ""),
    ("", "\nimport \"./dep.mjs\";"),
    ("", "\nexport {};"),
    ("export default 1; ", ""),
    ("await 0; ", ""),
    ("", "\n{ for await (const a of []) {} }"),
    ("import.meta.url; ", ""),
    ("import(\"./dep.mjs\"); ", ""),
    ("require(\"./dep.cjs\"); ", ""),
    ("import.meta.url; require(\"./dep.cjs\"); ", ""),
    ("", "\nmodule.exports = 1;"),
    ("exports.a = 1; ", ""),
    ("async function k() { await 0; } ", ""),
];

/// The folder and the extension of a file, and the type that the package.json of the folder says.
#[rustfmt::skip]
const NAMES: &[(&str, &str, ModuleType)] = &[
    ("", "js", ModuleType::Unknown),
    ("", "cjs", ModuleType::Unknown),
    ("", "mjs", ModuleType::Unknown),
    ("", "jsx", ModuleType::Unknown),
    ("module/", "js", ModuleType::Esm),
    ("module/", "cjs", ModuleType::Esm),
    ("commonjs/", "js", ModuleType::Cjs),
    ("commonjs/", "mjs", ModuleType::Cjs),
];

const FILES_OF_EVERY_FOLDER: &[(&str, &str)] = &[("dep.mjs", "export {};\n"), ("dep.cjs", "\n")];

struct Cell {
    name: String,
    text: String,
    module_type: ModuleType,
    is_control: bool,
}

type Axes = (
    &'static [(&'static str, bool)],
    &'static [(&'static str, &'static str)],
);

fn write_cells(
    (folder, extension, of_package): (&str, &str, ModuleType),
    (forms, places): Axes,
) -> Vec<Cell> {
    // What the module loader takes the type of a file from: its name, then its package.json.
    let module_type = match extension {
        "mjs" => ModuleType::Esm,
        "cjs" => ModuleType::Cjs,
        "js" => of_package,
        _ => ModuleType::Unknown,
    };
    let mut cells = Vec::new();
    for (file_start, file_end) in FILES {
        for (place_start, place_end) in places {
            for &(form, is_control) in forms {
                cells.push(Cell {
                    name: format!("{folder}c{}.{extension}", cells.len()),
                    text: format!("{file_start}{place_start}{form}{place_end}{file_end}\n"),
                    module_type,
                    is_control,
                });
            }
        }
    }
    cells
}

fn is_refused_by_bun_run(cell: &Cell, define: &Define) -> bool {
    let arena = AstArena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    let options = parser_options_of_bun_run(Loader::Jsx, cell.module_type);
    let path = format!("/project/{}", cell.name);
    let source = Source::init_path_string(path.as_bytes(), cell.text.as_bytes());
    let mut log = Log::init();
    let Ok(parser) = Parser::init(options, &mut log, &source, define, &arena) else {
        return true;
    };
    !matches!(parser.parse(), Ok(bun_js_parser::Result::Ast(_)) if !log.has_errors())
}

/// The index of each cell that the build reports an error in.
fn find_cells_refused_by_build(cells: &[Cell], folder: &str) -> Vec<usize> {
    let import = |cell: &Cell| format!("import \"./{}\";\n", cell.name);
    let main_text = cells.iter().map(import).collect::<String>();
    let package_json = |module_type: ModuleType| match module_type {
        ModuleType::Unknown => "{}",
        ModuleType::Cjs => r#"{ "type": "commonjs" }"#,
        ModuleType::Esm => r#"{ "type": "module" }"#,
    };
    let of_folder = |name: &str| format!("{folder}{name}");
    let names_of_folder: Vec<String> = (FILES_OF_EVERY_FOLDER.iter())
        .map(|(name, _)| of_folder(name))
        .collect();
    let of_package = NAMES.iter().find(|it| it.0 == folder).map(|it| it.2);
    let package_json_name = of_folder("package.json");
    let mut files = vec![("main.mjs", main_text.as_str())];
    if !folder.is_empty() {
        let text = package_json(of_package.unwrap_or_default());
        files.push((package_json_name.as_str(), text));
    }
    let texts = FILES_OF_EVERY_FOLDER.iter().map(|it| it.1);
    files.extend(names_of_folder.iter().map(String::as_str).zip(texts));
    files.extend(cells.iter().map(|it| (it.name.as_str(), it.text.as_str())));
    with_loaded_build(&files, &default_settings(), |build, loaded| {
        let bound = build.bind_modules(loaded).expect("modules are bound");
        let _ = build.check_and_lower(loaded, &bound);
        let mut log = Log::init();
        core::mem::replace(&mut build.diagnostics, Diagnostics::new()).write_to(&mut log);
        let errors = log.msgs.iter().filter(|it| it.kind == Kind::Err);
        let files_of_cells = cells
            .iter()
            .map(|it| strings::basename_posix(it.name.as_bytes()));
        let mut indexes: Vec<(&[u8], usize)> = files_of_cells.zip(0..).collect();
        indexes.sort_unstable();
        let mut refused: Vec<usize> = errors
            .map(|it| {
                let location = it.data.location.as_ref().expect("an error is in a file");
                let file = strings::basename_posix(&location.file);
                let found = indexes.binary_search_by_key(&file, |it| it.0);
                let text = bstr::BStr::new(&it.data.text);
                let found =
                    found.unwrap_or_else(|_| panic!("an error outside of the cells: {text}"));
                indexes[found].1
            })
            .collect();
        refused.sort_unstable();
        refused.dedup();
        refused
    })
}

/// The partings of one kind of file, and how many of its cells `bun run` refuses.
fn find_partings(name: (&str, &str, ModuleType), axes: Axes) -> (usize, usize, Vec<String>) {
    let cells = write_cells(name, axes);
    let define = Define::with_pure_globals(false, true);
    let refused_by_build = find_cells_refused_by_build(&cells, name.0);
    let (mut refused, mut partings) = (0, Vec::new());
    for (index, cell) in cells.iter().enumerate() {
        let is_refused_by_bun_run = is_refused_by_bun_run(cell, &define);
        let is_refused_by_build = refused_by_build.binary_search(&index).is_ok();
        refused += usize::from(is_refused_by_bun_run);
        let (name, text) = (&cell.name, &cell.text);
        if is_refused_by_bun_run && cell.is_control {
            partings.push(format!("bun run refuses a control, {name}: {text:?}"));
        }
        match (is_refused_by_bun_run, is_refused_by_build) {
            (true, false) => partings.push(format!("only bun run refuses {name}: {text:?}")),
            (false, true) => partings.push(format!("only the build refuses {name}: {text:?}")),
            (true, true) | (false, false) => {}
        }
    }
    (cells.len(), refused, partings)
}

/// How many cells the axes make, how many of them `bun run` refuses, and the partings.
fn compare_readers(axes: Axes) -> (usize, usize, Vec<String>) {
    let found: Vec<(usize, usize, Vec<String>)> = std::thread::scope(|scope| {
        let running: Vec<_> = NAMES
            .iter()
            .map(|&name| scope.spawn(move || find_partings(name, axes)))
            .collect();
        let found = running
            .into_iter()
            .map(|it| it.join().expect("no cell panics"));
        found.collect()
    });
    let cell_count: usize = found.iter().map(|it| it.0).sum();
    let refused: usize = found.iter().map(|it| it.1).sum();
    let partings: Vec<String> = found.into_iter().flat_map(|it| it.2).collect();
    (cell_count, refused, partings)
}

#[test]
fn build_refuses_a_sloppy_form_where_the_parser_of_bun_run_does() {
    let (cell_count, refused, partings) = compare_readers((FORMS, PLACES));
    // Both answers are in the grid: a reader that refuses everything, or nothing, agrees with no one.
    assert!(
        refused * 8 > cell_count && refused * 2 < cell_count,
        "bun run refuses {refused} of {cell_count} cells"
    );
    assert!(
        partings.is_empty(),
        "{} of {cell_count} cells:\n{}",
        partings.len(),
        partings.join("\n")
    );
}

#[test]
fn build_reads_a_legacy_html_comment_between_tokens_as_the_parser_of_bun_run_does() {
    let axes = (FORMS_WITH_A_MARK_INSIDE, PLACES_OF_A_MARK_INSIDE);
    let (cell_count, refused, partings) = compare_readers(axes);
    assert!(
        refused > 0 && refused < cell_count,
        "bun run refuses {refused} of {cell_count} cells"
    );
    assert!(
        partings.is_empty(),
        "{} of {cell_count} cells:\n{}",
        partings.len(),
        partings.join("\n")
    );
}

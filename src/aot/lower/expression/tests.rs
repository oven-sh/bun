use std::fs;
use std::path::{Path, PathBuf};

fn find_rust_files(folder: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(folder).expect("a folder of js_parser") {
        let path = entry.expect("an entry of the folder").path();
        if path.is_dir() {
            find_rust_files(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

fn find_function_name(line: &str) -> Option<&str> {
    let line = line.trim_start();
    let line = line.strip_prefix("pub(crate) ").unwrap_or(line);
    line.strip_prefix("fn ")?.split(['(', '<']).next()
}

#[test]
fn bun_run_simplifies_unused_expressions_at_the_places_that_the_lowering_knows() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../js_parser");
    let mut files = Vec::new();
    find_rust_files(&root, &mut files);
    files.sort();
    let mut callers = Vec::new();
    for file in files {
        if file.ends_with("scan/scan_side_effects.rs") {
            continue;
        }
        let text = fs::read_to_string(&file).expect("a source file of js_parser");
        let mut function = "";
        for line in text.lines() {
            function = find_function_name(line).unwrap_or(function);
            if line.contains("simplify_unused_expr(") {
                callers.push(function.to_owned());
            }
        }
    }
    let left_of_comma_where_it_minifies = "visit_right_and_finish";
    let test_of_conditional_with_known_answer = "e_if";
    let expression_statement = "s_expr";
    let test_of_if_with_known_answer = "s_if";
    assert_eq!(
        callers,
        [
            left_of_comma_where_it_minifies,
            left_of_comma_where_it_minifies,
            test_of_conditional_with_known_answer,
            test_of_conditional_with_known_answer,
            expression_statement,
            test_of_if_with_known_answer,
            test_of_if_with_known_answer,
        ]
    );
}

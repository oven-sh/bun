use bstr::BString;
use bun_core::strings::index_of;

use super::{MODULE_IMPORTER, MODULE_PATH, find_library_path, lower_files};
use crate::diagnostic_codes::Code;

const INVALID_POSITION: &str = "intrinsic is not valid in this position";
const WRONG_ARGUMENT_COUNT: &str = "wrong number of arguments to intrinsic";
const ARGUMENT_NOT_LITERAL: &str = "intrinsic argument must be a literal";
const UNKNOWN_LINKED_FUNCTION: &str = "the function of this name is not marked $linkTimeConstant";
const REACHABLE_BUNDLE_ERROR: &str = "$bundleError is reachable";

const MISUSES: [(&str, &str, &str); 15] = [
    (
        "export function probeValue(f: any) { f.$call; }",
        INVALID_POSITION,
        "f.$call",
    ),
    (
        "export function probeOptionalCall() { $createFIFO?.(); }",
        INVALID_POSITION,
        "$createFIFO",
    ),
    (
        "export function probeChainCallee(o: any, x: any) { (o?.$fastPath)(x); }",
        INVALID_POSITION,
        "o?.$fastPath",
    ),
    ("$argumentCount();", INVALID_POSITION, "$argumentCount"),
    (
        "export function probeRest(...a: any[]) { $argument(1); }",
        INVALID_POSITION,
        "$argument",
    ),
    (
        "export function probePosition(i: any) { $argument(i); }",
        ARGUMENT_NOT_LITERAL,
        "i)",
    ),
    (
        "export function probeMissing() { $isObject(); }",
        WRONG_ARGUMENT_COUNT,
        "$isObject",
    ),
    (
        "export function probeExtra(o: any) { $isCallable(o, o); }",
        WRONG_ARGUMENT_COUNT,
        "$isCallable",
    ),
    (
        "export function probeSpread(a: any) { $isUndefinedOrNull(...a); }",
        WRONG_ARGUMENT_COUNT,
        "$isUndefinedOrNull",
    ),
    (
        "export function probeSpreadThis(f: any, a: any) { f.$call(...a); }",
        WRONG_ARGUMENT_COUNT,
        "...a",
    ),
    (
        "export function probeComputed(o: any, index: any) { $getInternalField(o, index); }",
        ARGUMENT_NOT_LITERAL,
        "index)",
    ),
    (
        "export function probeAbsentWord(o: any) { $getInternalField(o, 4294967295); }",
        ARGUMENT_NOT_LITERAL,
        "4294967295",
    ),
    (
        "export function probeWide(o: any) { $getInternalField(o, 4294967296); }",
        ARGUMENT_NOT_LITERAL,
        "4294967296",
    ),
    (
        "export function probeFraction(o: any) { $getInternalField(o, 1.5); }",
        ARGUMENT_NOT_LITERAL,
        "1.5",
    ),
    (
        "export function probeBundleError() { $bundleError(\"probe\"); }",
        REACHABLE_BUNDLE_ERROR,
        "$bundleError",
    ),
];

#[track_caller]
fn offset_of(source: &str, text: &str) -> u32 {
    let offset = index_of(source.as_bytes(), text.as_bytes());
    offset.expect("the source has the text") as u32
}

fn collect_misuses(files: &[(&str, &str)]) -> Vec<(u32, BString)> {
    let lowered = lower_files(files);
    let diagnostics = lowered
        .files()
        .flat_map(|lowered| lowered.diagnostics.iter());
    let misuses = diagnostics.filter(|diagnostic| diagnostic.code == Code::InvalidRuntimeSource);
    let mut misuses: Vec<(u32, BString)> = misuses
        .map(|diagnostic| {
            let start = diagnostic.span.map_or(0, |span| span.start);
            (start, BString::from(diagnostic.arguments[0].as_slice()))
        })
        .collect();
    misuses.sort_unstable();
    misuses
}

#[test]
fn misuses_are_reported_at_expression() {
    let mut source = String::new();
    let mut expected = Vec::new();
    for (statement, message, misused) in MISUSES {
        let start = source.len() as u32 + offset_of(statement, misused);
        expected.push((start, BString::from(message)));
        source.push_str(statement);
        source.push('\n');
    }
    let files = [MODULE_IMPORTER, (MODULE_PATH, source.as_str())];
    assert_eq!(collect_misuses(&files), expected, "{source}");
}

#[test]
fn well_formed_intrinsics_are_not_reported() {
    let source = "export function probe(f: any, o: any) {
  if ($isObject(o)) return f.$call(o, $getInternalField(o, 0));
  return $argumentCount();
}
";
    let misuses = collect_misuses(&[MODULE_IMPORTER, (MODULE_PATH, source)]);
    assert!(misuses.is_empty(), "{misuses:?}");
}

#[test]
fn unknown_linked_function_is_reported() {
    let source = "export function probe(target: any) { return $flatIntoArray(target); }";
    let library_path = find_library_path("flatIntoArray");
    let files = [
        MODULE_IMPORTER,
        (MODULE_PATH, source),
        (library_path.as_str(), "export function at() {}\n"),
    ];
    let start = offset_of(source, "$flatIntoArray");
    let expected = [(start, BString::from(UNKNOWN_LINKED_FUNCTION))];
    assert_eq!(collect_misuses(&files), expected);
}

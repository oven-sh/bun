use bstr::BStr;
use bun_builtin_sources::{Archive, VIRTUAL_ROOT};
use bun_sema::check::aot::FunctionRef;
use rustc_hash::FxHashMap;

use super::collect_linked_functions;
use crate::builtins::id::RuntimeFunction;
use crate::builtins::table;
use crate::compile::collect_file_inputs;
use crate::compile::testing::{default_settings, with_bind_input, with_runtime_bind_input};
use crate::lower::LibraryFunctions;
use crate::modules::BindInput;
use crate::modules::testing::file_named;

const EMPTY_PROGRAM: (&str, &str) = ("main.ts", "export {};");
const MARKED_FUNCTION: &str = "$linkTimeConstant;\nexport function flatIntoArray() {}\n";
const ARRAY_CONSTRUCTOR: &str = "ArrayConstructor";
const ARRAY_PROTOTYPE: &str = "ArrayPrototype";

fn find_runtime_function(file: &str, export_name: &str) -> RuntimeFunction {
    let mut functions = table::runtime_functions().iter();
    let found = functions.find(|data| data.file == file && data.export_name == export_name);
    found
        .expect("the built-ins table lists the function")
        .function
}

fn flat_into_array() -> RuntimeFunction {
    find_runtime_function(ARRAY_PROTOTYPE, "flatIntoArray")
}

fn source_path_of(function: RuntimeFunction) -> String {
    let archive_name = Archive::embedded().manifest().function_file(function.0);
    let archive_name = archive_name.expect("the manifest lists the file of the function");
    let path = [VIRTUAL_ROOT, archive_name].concat();
    let path = str::from_utf8(&path).expect("archive names are ASCII");
    path.to_owned()
}

fn create_library_functions(input: &BindInput<'_, '_>) -> LibraryFunctions {
    let file_inputs = collect_file_inputs(input.files, input.sources);
    LibraryFunctions::compute(input.files, &file_inputs, input.sources)
}

fn collect_functions(input: &BindInput<'_, '_>) -> FxHashMap<RuntimeFunction, FunctionRef> {
    let file_inputs = collect_file_inputs(input.files, input.sources);
    collect_linked_functions(input.files, &file_inputs, input.sources)
}

#[test]
fn only_marked_functions_are_linked() {
    with_runtime_bind_input(&[EMPTY_PROGRAM], |input| {
        let linked = create_library_functions(input);
        let found = linked.find(flat_into_array());
        let found = found.expect("flatIntoArray is a link-time constant");
        let name = input.files.hir(found.file)[found.function].name;
        assert_eq!(BStr::new(input.files.atoms.bytes(name)), "flatIntoArray");
        let unmarked = find_runtime_function(ARRAY_PROTOTYPE, "at");
        assert_eq!(linked.find(unmarked), None);
    });
}

#[test]
fn function_is_linked_by_file_and_name() {
    let prototype_path = source_path_of(flat_into_array());
    let constructor_path = source_path_of(find_runtime_function(ARRAY_CONSTRUCTOR, "from"));
    let files = [
        EMPTY_PROGRAM,
        (constructor_path.as_str(), MARKED_FUNCTION),
        (prototype_path.as_str(), MARKED_FUNCTION),
    ];
    with_runtime_bind_input(&files, |input| {
        let prototype_file = file_named(input, &prototype_path);
        let constructor_file = file_named(input, &constructor_path);
        let linked = collect_functions(input);
        let found = linked.get(&flat_into_array());
        assert_eq!(found.map(|function| function.file), Some(prototype_file));
        let mut linked_files = linked.values().map(|function| function.file);
        assert!(linked_files.all(|file| file != constructor_file));
    });
}

#[test]
fn marked_function_of_runtime_module_is_not_linked() {
    const MODULE_PATH: &str = "/$bun/js/node/os.ts";
    let files = [
        ("main.ts", "import \"node:os\";"),
        (MODULE_PATH, MARKED_FUNCTION),
    ];
    with_runtime_bind_input(&files, |input| {
        let module_file = file_named(input, MODULE_PATH);
        let linked = collect_functions(input);
        assert!(linked.contains_key(&flat_into_array()));
        let mut linked_files = linked.values().map(|function| function.file);
        assert!(linked_files.all(|file| file != module_file));
    });
}

#[test]
fn application_functions_are_not_linked() {
    let files = [("main.ts", MARKED_FUNCTION)];
    with_bind_input(&files, &default_settings(), |input| {
        assert!(collect_functions(input).is_empty());
        let linked = create_library_functions(input);
        assert_eq!(linked.find(flat_into_array()), None);
    });
}

#[test]
fn default_table_is_empty() {
    let linked = LibraryFunctions::default();
    assert_eq!(linked.find(flat_into_array()), None);
}

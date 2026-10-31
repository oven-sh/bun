use core::fmt;

use bstr::{BStr, BString};
use bun_ast::Log;
use bun_core::strings;
use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::{Constant, Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::session::Arena;

use self::DefinedValue::GlobalPath;
use crate::builtins::id::BuiltinId;
use crate::compile::testing::{default_settings, lower_program_with_provider};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{ECMAMode, EntryParameter, Function, TerminatorKind};
use crate::ir::ids::optional_id_from_word;
use crate::ir::{
    EntryPosition, Id, NameTables, Opcode, PropertyKeyId, Reference, StringId, TerminatorView,
    TypeId, ValueId, ValueView, print_function,
};
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, ModuleName, Resolution, ResolveRequest,
    SourceFile, SourceProvider, WithoutServices,
};
use crate::lower::Fragment;

const IS_FREE_NAME: u32 = 1 << 0;
const IS_FOR_TYPE_OF: u32 = 1 << 1;

const PATHS: &[(&str, DefinedValue)] = &[
    ("PROBE_NAME", GlobalPath("probeTarget")),
    ("PROBE_PATH", GlobalPath("probeHolder.inner.member")),
    ("process.env.PROBE_ALIAS", GlobalPath("probeHolder.member")),
];

const RENAMED: &[(&str, DefinedValue)] = &[
    ("ALIAS_NAME", GlobalPath("probeTarget")),
    ("ALIAS_PATH", GlobalPath("probeHolder.member")),
];

const BUILTINS: &[(&str, DefinedValue)] = &[
    ("PROBE_SYMBOL", GlobalPath("Symbol")),
    ("PROBE_ITERATOR", GlobalPath("Symbol.iterator")),
    ("PROBE_CONSOLE", GlobalPath("console")),
    ("PROBE_FLOOR", GlobalPath("Math.floor")),
    ("PROBE_NOW", GlobalPath("Date.now")),
    ("PROBE_LOG", GlobalPath("console.log")),
];

#[derive(Copy, Clone)]
enum DefinedValue {
    GlobalPath(&'static str),
    String(&'static str),
    Number(f64),
}

fn intern_dotted_name<'s>(name: &str, arena: &'s Arena, atoms: &Interner<'s>) -> &'s [Atom] {
    let parts = strings::split(name.as_bytes(), b".").map(|part| atoms.intern(part));
    let parts: Vec<Atom> = parts.collect();
    arena.alloc_slice_copy(&parts)
}

struct Defines<'a>(&'a [(&'a str, DefinedValue)]);

impl SourceProvider for Defines<'_> {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let create_define = |&(name, value): &(&str, DefinedValue)| {
            let path = intern_dotted_name(name, arena, atoms);
            let (&root, members) = path.split_first().expect("a define has a name");
            let value = match value {
                DefinedValue::GlobalPath(path) => {
                    DefineValue::GlobalPath(intern_dotted_name(path, arena, atoms))
                }
                DefinedValue::String(text) => {
                    DefineValue::Constant(Constant::String(atoms.intern(text.as_bytes())))
                }
                DefinedValue::Number(number) => DefineValue::Constant(Constant::Number(number)),
            };
            Define {
                path: DefinePath {
                    root: DefineRoot::Global(root),
                    members,
                },
                value,
            }
        };
        let defines: Vec<Define<'s>> = self.0.iter().map(create_define).collect();
        FoldOptions {
            defines: arena.alloc_slice_copy(&defines),
            ..WithoutServices.fold_options(arena, atoms, log)
        }
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        WithoutServices.has_load_plugin(module)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        WithoutServices.run_macro(call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        WithoutServices.bundle_pages(pages, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[derive(Copy, Clone, Debug)]
struct PropertyRead {
    id: ValueId,
    object: ValueId,
    key: PropertyKeyId,
    is_free_name: bool,
    is_for_type_of: bool,
}

#[derive(Copy, Clone, Debug)]
struct PropertyStore {
    object: ValueId,
    key: PropertyKeyId,
    mode: ECMAMode,
    value: ValueId,
    is_free_name: bool,
}

#[derive(Copy, Clone, Debug)]
struct PropertyDelete {
    object: ValueId,
    key: PropertyKeyId,
    mode: ECMAMode,
    is_free_name: bool,
}

#[derive(Copy, Clone, Debug)]
struct CallOperation {
    callee: ValueId,
    this: Option<ValueId>,
    key: Option<PropertyKeyId>,
    name: Option<StringId>,
}

#[track_caller]
fn panic_at(operation: ValueView<'_>, expected: Opcode) -> ! {
    let (id, found) = (operation.id, operation.opcode.name());
    panic!("{id} is a {found}, not a {}", expected.name());
}

#[track_caller]
fn decode_read(operation: ValueView<'_>) -> PropertyRead {
    let (Opcode::PropGet, &[flags, object, key]) = (operation.opcode, operation.fields) else {
        panic_at(operation, Opcode::PropGet);
    };
    PropertyRead {
        id: operation.id,
        object: ValueId::from_word(object),
        key: PropertyKeyId::from_word(key),
        is_free_name: flags & IS_FREE_NAME != 0,
        is_for_type_of: flags & IS_FOR_TYPE_OF != 0,
    }
}

#[track_caller]
fn decode_store(operation: ValueView<'_>) -> PropertyStore {
    let (Opcode::PropSet, &[flags, object, key, mode, value]) =
        (operation.opcode, operation.fields)
    else {
        panic_at(operation, Opcode::PropSet);
    };
    PropertyStore {
        object: ValueId::from_word(object),
        key: PropertyKeyId::from_word(key),
        mode: ECMAMode::from_wire(mode).expect("the word is a mode"),
        value: ValueId::from_word(value),
        is_free_name: flags & IS_FREE_NAME != 0,
    }
}

#[track_caller]
fn decode_delete(operation: ValueView<'_>) -> PropertyDelete {
    let (Opcode::PropDelete, &[flags, object, key, mode]) = (operation.opcode, operation.fields)
    else {
        panic_at(operation, Opcode::PropDelete);
    };
    PropertyDelete {
        object: ValueId::from_word(object),
        key: PropertyKeyId::from_word(key),
        mode: ECMAMode::from_wire(mode).expect("the word is a mode"),
        is_free_name: flags & IS_FREE_NAME != 0,
    }
}

#[track_caller]
fn decode_call(operation: ValueView<'_>) -> CallOperation {
    let (Opcode::Call, &[_, callee, this, argument_count, ref rest @ ..]) =
        (operation.opcode, operation.fields)
    else {
        panic_at(operation, Opcode::Call);
    };
    let [key, name, _, _, _] = rest[argument_count as usize..] else {
        panic!("five fields follow the arguments of {}", operation.id);
    };
    CallOperation {
        callee: ValueId::from_word(callee),
        this: optional_id_from_word(this),
        key: optional_id_from_word(key),
        name: optional_id_from_word(name),
    }
}

struct Probe {
    fragment: Fragment,
    index: usize,
}

impl fmt::Display for Probe {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let names = NameTables {
            strings: &self.fragment.strings,
            property_keys: &self.fragment.property_keys,
            types: &self.fragment.types,
        };
        let (id, function) = &self.fragment.functions[self.index];
        let mut text = String::new();
        print_function(names, *id, function, &mut text);
        formatter.write_str(&text)
    }
}

impl Probe {
    fn function(&self) -> &Function {
        &self.fragment.functions[self.index].1
    }

    fn operations(&self) -> impl Iterator<Item = ValueView<'_>> {
        let blocks = self.function().body.blocks();
        blocks.flat_map(|block| block.values())
    }

    fn all(&self, opcode: Opcode) -> Vec<ValueView<'_>> {
        let operations = self.operations();
        operations
            .filter(|operation| operation.opcode == opcode)
            .collect()
    }

    fn count(&self, opcode: Opcode) -> usize {
        self.all(opcode).len()
    }

    #[track_caller]
    fn only(&self, opcode: Opcode) -> ValueView<'_> {
        let [operation] = self.all(opcode)[..] else {
            panic!("expected one {}:\n{self}", opcode.name());
        };
        operation
    }

    fn skip_requests(&self, value: ValueId) -> ValueId {
        match self.operations().find(|operation| operation.id == value) {
            Some(request) if request.opcode == Opcode::Convert => {
                self.skip_requests(ValueId::from_word(request.fields[0]))
            }
            Some(_) | None => value,
        }
    }

    #[track_caller]
    fn definition(&self, value: ValueId) -> ValueView<'_> {
        let value = self.skip_requests(value);
        let operation = self.operations().find(|operation| operation.id == value);
        operation.unwrap_or_else(|| panic!("no operation defines {value}:\n{self}"))
    }

    #[track_caller]
    fn returned(&self) -> ValueId {
        let blocks = self.function().body.blocks();
        let returns: Vec<TerminatorView<'_>> = blocks
            .map(|block| block.terminator())
            .filter(|terminator| terminator.kind == TerminatorKind::Return)
            .collect();
        let [
            TerminatorView {
                fields: &[value], ..
            },
        ] = returns[..]
        else {
            panic!("expected one return:\n{self}");
        };
        ValueId::from_word(value)
    }

    fn string_text(&self, string: StringId) -> &BStr {
        BStr::new(self.fragment.strings.get(string))
    }

    #[track_caller]
    fn key_text(&self, key: PropertyKeyId) -> &BStr {
        let text = self.fragment.property_keys.get(key).text;
        self.string_text(text.expect("the key is a text"))
    }

    #[track_caller]
    fn builtin_of(&self, value: ValueId) -> Option<BuiltinId> {
        let operation = self.definition(value);
        let (Opcode::Builtin, &[_, builtin]) = (operation.opcode, operation.fields) else {
            return None;
        };
        BuiltinId::from_wire(builtin)
    }

    #[track_caller]
    fn expect_builtin(&self, value: ValueId, builtin: BuiltinId) {
        assert_eq!(self.builtin_of(value), Some(builtin), "{self}");
    }

    #[track_caller]
    fn first_parameter(&self) -> ValueId {
        let position = EntryPosition::new(EntryParameter::Parameter, 0);
        let index = self.function().entry_parameter_index(position);
        ValueId::new(index.expect("the function declares the parameter"))
    }

    #[track_caller]
    fn expect_parameter(&self, value: ValueId) {
        assert_eq!(self.skip_requests(value), self.first_parameter(), "{self}");
    }

    #[track_caller]
    fn expect_path(&self, value: ValueId, path: &[&str]) {
        assert_eq!(self.read_path(value), path, "{self}");
    }

    fn named_builtins(&self) -> Vec<BuiltinId> {
        let operations = self.all(Opcode::Builtin).into_iter();
        operations
            .filter_map(|operation| self.builtin_of(operation.id))
            .collect()
    }

    fn expected_builtins(&self, conversion: ValueView<'_>) -> &[BuiltinId] {
        let (Opcode::Convert, &[_, expected, ..]) = (conversion.opcode, conversion.fields) else {
            panic!("{} is no Convert:\n{self}", conversion.id);
        };
        let expected = self.fragment.types.get(TypeId::from_word(expected));
        &expected.builtins
    }

    #[track_caller]
    fn expect_prediction(&self, conversion: ValueView<'_>, builtin: BuiltinId) {
        assert_eq!(self.expected_builtins(conversion), [builtin], "{self}");
    }

    #[track_caller]
    fn integer_of(&self, value: ValueId) -> Option<i64> {
        let operation = self.definition(value);
        let (Opcode::Integer, &[low, high]) = (operation.opcode, operation.fields) else {
            return None;
        };
        Some((u64::from(low) | (u64::from(high) << 32)) as i64)
    }

    fn reads(&self) -> Vec<PropertyRead> {
        let operations = self.all(Opcode::PropGet).into_iter();
        operations.map(decode_read).collect()
    }

    fn free_name_reads(&self) -> Vec<PropertyRead> {
        let mut reads = self.reads();
        reads.retain(|read| read.is_free_name);
        reads
    }

    fn reads_of(&self, name: &str) -> Vec<PropertyRead> {
        let mut reads = self.reads();
        reads.retain(|read| {
            let text = self.fragment.property_keys.get(read.key).text;
            text.is_some_and(|text| self.string_text(text) == name)
        });
        reads
    }

    #[track_caller]
    fn read_of(&self, value: ValueId) -> PropertyRead {
        decode_read(self.definition(value))
    }

    #[track_caller]
    fn only_store(&self) -> PropertyStore {
        decode_store(self.only(Opcode::PropSet))
    }

    #[track_caller]
    fn read_path(&self, value: ValueId) -> Vec<&BStr> {
        let read = self.read_of(value);
        let mut path = if read.is_free_name {
            self.expect_builtin(read.object, BuiltinId::GlobalThis);
            Vec::new()
        } else {
            self.read_path(read.object)
        };
        path.push(self.key_text(read.key));
        path
    }

    // The members that are read one below the other, from the first parameter down to `value`.
    #[track_caller]
    fn path_below_parameter(&self, value: ValueId) -> Vec<&BStr> {
        let parameter = self.first_parameter();
        let mut path = Vec::new();
        let mut value = self.skip_requests(value);
        while value != parameter {
            let read = self.read_of(value);
            assert!(!read.is_free_name, "{self}");
            path.push(self.key_text(read.key));
            value = self.skip_requests(read.object);
        }
        path.reverse();
        path
    }

    fn names_text(&self, text: &str) -> bool {
        let mut is_named = false;
        self.function().body.for_each_reference(&mut |reference| {
            let string = match reference {
                Reference::String(string) => Some(string),
                Reference::PropertyKey(key) => self.fragment.property_keys.get(key).text,
                _ => None,
            };
            is_named |= string.is_some_and(|string| self.string_text(string) == text);
        });
        is_named
    }
}

fn lower_file(defines: &[(&str, DefinedValue)], name: &str, source: &str) -> Probe {
    let files = [(name, source)];
    let provider = Defines(defines);
    let mut lowered = lower_program_with_provider(&files, &default_settings(), &provider);
    assert_eq!(lowered.len(), 1);
    let fragment = lowered.remove(0).1.fragment;
    let index = fragment.functions.iter().position(|(_, function)| {
        let text = function.name.map(|name| fragment.strings.get(name));
        text == Some(&b"probe"[..])
    });
    let index = index.expect("the file defines a function named probe");
    Probe { fragment, index }
}

fn lower_body(defines: &[(&str, DefinedValue)], body: &str) -> Probe {
    let source = format!("export function probe(a) {{ {body} }}");
    lower_file(defines, "main.js", &source)
}

fn lower_sloppy_body(defines: &[(&str, DefinedValue)], body: &str) -> Probe {
    let source = format!("module.exports = function probe(a) {{ {body} }};");
    lower_file(defines, "main.cjs", &source)
}

fn lower_with_parameter(defines: &[(&str, DefinedValue)], parameter: &str, body: &str) -> Probe {
    let source = format!("export function probe({parameter}, a) {{ {body} }}");
    lower_file(defines, "main.js", &source)
}

#[track_caller]
fn offset_of(source: &str, text: &str) -> u32 {
    let offset = strings::index_of(source.as_bytes(), text.as_bytes());
    offset.expect("the source has the text") as u32
}

// Where lowering stops the build for a define, and what it says that --aot does not support.
fn collect_stops(defines: &[(&str, DefinedValue)], files: &[(&str, &str)]) -> Vec<(u32, BString)> {
    let provider = Defines(defines);
    let lowered = lower_program_with_provider(files, &default_settings(), &provider);
    let diagnostics = lowered.iter().flat_map(|(_, file)| file.diagnostics.iter());
    let stops = diagnostics.filter(|diagnostic| diagnostic.code == Code::UnsupportedOption);
    stops
        .map(|diagnostic| {
            let start = diagnostic.span.map_or(0, |span| span.start);
            (start, BString::from(diagnostic.arguments[0].as_slice()))
        })
        .collect()
}

// The sentences are those of the `/* Build errors: */` lines under test/aot/parallel/bundler.
fn stop_text(key: &str, value: &str, reason: &str) -> BString {
    BString::from(format!(
        "--define {key}={value} where {reason}. The value is read as a name. A string needs quotes: --define '{key}=\"{value}\"'"
    ))
}

#[test]
fn global_path_define() {
    let rows: [(&str, &[&str]); 3] = [
        ("PROBE_NAME", &["probeTarget"]),
        ("PROBE_PATH", &["probeHolder", "inner", "member"]),
        ("process.env.PROBE_ALIAS", &["probeHolder", "member"]),
    ];
    for (expression, path) in rows {
        let probe = lower_body(PATHS, &format!("return {expression};"));
        assert_eq!(probe.read_path(probe.returned()), path, "{probe}");
        assert_eq!(probe.count(Opcode::PropGet), path.len(), "{probe}");
        assert_eq!(probe.free_name_reads().len(), 1, "{probe}");
        assert!(
            probe.reads().iter().all(|read| !read.is_for_type_of),
            "{probe}"
        );
        assert_eq!(probe.named_builtins(), [BuiltinId::GlobalThis], "{probe}");
    }
}

#[test]
fn local_binding_is_not_the_defined_name() {
    let source = "export function probe(PROBE_PATH) { return PROBE_PATH; }";
    let probe = lower_file(PATHS, "main.js", source);
    probe.expect_parameter(probe.returned());
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
    assert_eq!(probe.count(Opcode::Builtin), 0, "{probe}");
}

#[test]
fn defined_name_is_the_binding_in_scope() {
    let probe = lower_with_parameter(PATHS, "probeTarget", "return PROBE_NAME;");
    probe.expect_parameter(probe.returned());
    assert_eq!(probe.count(Opcode::PropGet), 0, "{probe}");
    assert_eq!(probe.count(Opcode::Builtin), 0, "{probe}");

    let tested = lower_with_parameter(PATHS, "probeTarget", "return typeof PROBE_NAME;");
    let operand = ValueId::from_word(tested.only(Opcode::TypeOf).fields[0]);
    tested.expect_parameter(operand);
    assert_eq!(tested.count(Opcode::PropGet), 0, "{tested}");

    let constant = lower_body(PATHS, "const probeTarget = a; return PROBE_NAME;");
    constant.expect_parameter(constant.returned());
    assert_eq!(constant.count(Opcode::PropGet), 0, "{constant}");
}

#[test]
fn defined_path_is_read_below_the_binding_of_its_first_name() {
    let rows: [(&str, &[&str]); 2] = [
        ("PROBE_PATH", &["inner", "member"]),
        ("process.env.PROBE_ALIAS", &["member"]),
    ];
    for (expression, members) in rows {
        let body = format!("return {expression};");
        let probe = lower_with_parameter(PATHS, "probeHolder", &body);
        let path = probe.path_below_parameter(probe.returned());
        assert_eq!(path, members, "{probe}");
        assert_eq!(probe.count(Opcode::PropGet), members.len(), "{probe}");
        assert_eq!(probe.count(Opcode::Builtin), 0, "{probe}");
    }

    let source =
        "const probeHolder = JSON.parse(\"{}\"); export function probe(a) { return ALIAS_PATH; }";
    let of_file = lower_file(RENAMED, "main.js", source);
    assert_eq!(of_file.reads_of("member").len(), 1, "{of_file}");
    assert!(of_file.free_name_reads().is_empty(), "{of_file}");
}

#[test]
fn defined_path_is_read_for_effect() {
    let probe = lower_body(PATHS, "PROBE_PATH;");
    let [_, _, member] = probe.reads()[..] else {
        panic!("expected three reads:\n{probe}");
    };
    probe.expect_path(member.id, &["probeHolder", "inner", "member"]);
}

#[test]
fn global_path_define_resolves_builtin() {
    let locked_rows = [
        ("PROBE_ITERATOR", BuiltinId::SymbolIterator),
        ("PROBE_FLOOR", BuiltinId::MathFloor),
    ];
    for (name, builtin) in locked_rows {
        let locked = lower_body(BUILTINS, &format!("return {name};"));
        locked.expect_builtin(locked.returned(), builtin);
        assert_eq!(locked.named_builtins(), [builtin], "{locked}");
        assert_eq!(locked.count(Opcode::PropGet), 0, "{locked}");
    }

    let rows = [
        ("PROBE_NOW", ["Date", "now"], BuiltinId::DateNow),
        ("PROBE_LOG", ["console", "log"], BuiltinId::ConsoleLog),
    ];
    for (name, path, builtin) in rows {
        let predicted = lower_body(BUILTINS, &format!("return {name};"));
        let prediction = predicted.only(Opcode::Convert);
        assert_eq!(predicted.returned(), prediction.id, "{predicted}");
        predicted.expect_prediction(prediction, builtin);
        assert_eq!(predicted.read_path(prediction.id), path, "{predicted}");
        assert_eq!(predicted.count(Opcode::PropGet), 2, "{predicted}");
        assert_eq!(
            predicted.named_builtins(),
            [BuiltinId::GlobalThis],
            "{predicted}"
        );
    }

    let unknown = lower_body(PATHS, "return PROBE_PATH;");
    for prediction in unknown.all(Opcode::Convert) {
        assert!(
            unknown.expected_builtins(prediction).is_empty(),
            "{unknown}"
        );
    }
}

#[test]
fn defined_path_of_a_builtin_below_a_binding_is_no_builtin() {
    let read = lower_with_parameter(BUILTINS, "Math", "return PROBE_FLOOR;");
    let path = read.path_below_parameter(read.returned());
    assert_eq!(path, ["floor"], "{read}");
    assert_eq!(read.count(Opcode::Builtin), 0, "{read}");
    for conversion in read.all(Opcode::Convert) {
        assert!(read.expected_builtins(conversion).is_empty(), "{read}");
    }

    let tested = lower_with_parameter(BUILTINS, "Symbol", "return typeof PROBE_SYMBOL;");
    let operand = ValueId::from_word(tested.only(Opcode::TypeOf).fields[0]);
    tested.expect_parameter(operand);
    assert_eq!(tested.count(Opcode::Builtin), 0, "{tested}");

    let defines = [("settle", GlobalPath("Symbol.for"))];
    let called = lower_with_parameter(&defines, "Symbol", "return settle(1);");
    let call = decode_call(called.only(Opcode::Call));
    let path = called.path_below_parameter(call.callee);
    assert_eq!(path, ["for"], "{called}");
    called.expect_parameter(call.this.expect("the parameter is the receiver"));
    assert_eq!(called.count(Opcode::Builtin), 0, "{called}");
}

#[test]
fn store_to_defined_name_goes_to_global() {
    let rows = [
        ("ALIAS_NAME = 1;", 0),
        ("ALIAS_NAME++;", 1),
        ("ALIAS_NAME += a;", 1),
        ("[ALIAS_NAME] = a;", 0),
        ("({ x: ALIAS_NAME } = a);", 0),
    ];
    for (body, read_count) in rows {
        let probe = lower_body(RENAMED, body);
        let store = probe.only_store();
        assert!(store.is_free_name, "{body}\n{probe}");
        assert_eq!(
            probe.builtin_of(store.object),
            Some(BuiltinId::GlobalThis),
            "{body}\n{probe}"
        );
        assert_eq!(probe.key_text(store.key), "probeTarget", "{body}\n{probe}");
        assert!(!probe.names_text("ALIAS_NAME"), "{body}\n{probe}");

        let reads = probe.free_name_reads();
        assert_eq!(reads.len(), read_count, "{body}\n{probe}");
        for read in reads {
            assert_eq!(probe.read_path(read.id), ["probeTarget"], "{body}\n{probe}");
            assert!(!read.is_for_type_of, "{body}\n{probe}");
        }
    }
    let plain = lower_body(RENAMED, "ALIAS_NAME = 1;");
    assert_eq!(
        plain.integer_of(plain.only_store().value),
        Some(1),
        "{plain}"
    );
}

#[test]
fn store_to_defined_name_goes_to_the_binding_in_scope() {
    let rows = [
        "ALIAS_NAME = a;",
        "ALIAS_NAME++;",
        "ALIAS_NAME += a;",
        "[ALIAS_NAME] = a;",
        "({ x: ALIAS_NAME } = a);",
    ];
    for statement in rows {
        let body = format!("{statement} return probeTarget;");
        let probe = lower_with_parameter(RENAMED, "probeTarget", &body);
        let returned = probe.skip_requests(probe.returned());
        assert_ne!(returned, probe.first_parameter(), "{body}\n{probe}");
        assert_eq!(probe.count(Opcode::PropSet), 0, "{body}\n{probe}");
        assert!(probe.free_name_reads().is_empty(), "{body}\n{probe}");
        assert!(!probe.names_text("ALIAS_NAME"), "{body}\n{probe}");
    }
    let body = "ALIAS_NAME = 1; return probeTarget;";
    let plain = lower_with_parameter(RENAMED, "probeTarget", body);
    assert_eq!(plain.integer_of(plain.returned()), Some(1), "{plain}");
}

#[test]
fn store_to_defined_path_sets_member() {
    let rows = [
        ("ALIAS_PATH = 1;", 0),
        ("ALIAS_PATH++;", 1),
        ("ALIAS_PATH += a;", 1),
        ("[ALIAS_PATH] = a;", 0),
        ("({ x: ALIAS_PATH } = a);", 0),
    ];
    for (body, read_count) in rows {
        let probe = lower_body(RENAMED, body);
        let store = probe.only_store();
        assert!(!store.is_free_name, "{body}\n{probe}");
        assert_eq!(probe.key_text(store.key), "member", "{body}\n{probe}");
        assert_eq!(
            probe.read_path(store.object),
            ["probeHolder"],
            "{body}\n{probe}"
        );
        assert_eq!(probe.free_name_reads().len(), 1, "{body}\n{probe}");
        assert!(!probe.names_text("ALIAS_PATH"), "{body}\n{probe}");

        let member_reads = probe.reads_of("member");
        assert_eq!(member_reads.len(), read_count, "{body}\n{probe}");
        for read in member_reads {
            assert_eq!(read.object, store.object, "{body}\n{probe}");
            assert!(!read.is_free_name, "{body}\n{probe}");
        }
    }
}

#[test]
fn store_to_defined_path_sets_member_of_the_binding_in_scope() {
    let rows = [
        ("ALIAS_PATH = 1;", 0),
        ("ALIAS_PATH++;", 1),
        ("ALIAS_PATH += a;", 1),
        ("[ALIAS_PATH] = a;", 0),
        ("({ x: ALIAS_PATH } = a);", 0),
    ];
    for (body, read_count) in rows {
        let probe = lower_with_parameter(RENAMED, "probeHolder", body);
        let store = probe.only_store();
        assert!(!store.is_free_name, "{body}\n{probe}");
        assert_eq!(probe.key_text(store.key), "member", "{body}\n{probe}");
        probe.expect_parameter(store.object);
        assert!(probe.free_name_reads().is_empty(), "{body}\n{probe}");
        assert!(!probe.names_text("ALIAS_PATH"), "{body}\n{probe}");

        let member_reads = probe.reads_of("member");
        assert_eq!(member_reads.len(), read_count, "{body}\n{probe}");
        for read in member_reads {
            assert_eq!(read.object, store.object, "{body}\n{probe}");
        }
    }
}

#[test]
fn global_path_define_is_assignment_target() {
    let path = lower_body(PATHS, "PROBE_PATH += 1;");
    let store = path.only_store();
    assert_eq!(path.key_text(store.key), "member", "{path}");
    path.expect_path(store.object, &["probeHolder", "inner"]);
    assert_eq!(path.count(Opcode::PropGet), 3, "{path}");
    let [member_read] = path.reads_of("member")[..] else {
        panic!("expected one read of the member:\n{path}");
    };
    assert_eq!(member_read.object, store.object, "{path}");

    let logical = lower_body(PATHS, "PROBE_NAME ??= a;");
    assert_eq!(logical.free_name_reads().len(), 1, "{logical}");
    let store = logical.only_store();
    assert!(store.is_free_name, "{logical}");
    assert_eq!(logical.key_text(store.key), "probeTarget", "{logical}");
    logical.expect_parameter(store.value);

    let local = lower_body(PATHS, "let PROBE_NAME; PROBE_NAME = 1; return PROBE_NAME;");
    assert_eq!(local.count(Opcode::PropSet), 0, "{local}");
    assert_eq!(local.count(Opcode::PropGet), 0, "{local}");
}

#[test]
fn store_mode_is_strictness_of_code() {
    for body in ["ALIAS_NAME = a;", "ALIAS_PATH = a;"] {
        let strict = lower_body(RENAMED, body);
        assert_eq!(strict.only_store().mode, ECMAMode::Strict, "{strict}");
        let sloppy = lower_sloppy_body(RENAMED, body);
        assert_eq!(sloppy.only_store().mode, ECMAMode::Sloppy, "{sloppy}");
    }
}

#[test]
fn typeof_defined_name() {
    let name = lower_body(PATHS, "return typeof PROBE_NAME;");
    let operand = ValueId::from_word(name.only(Opcode::TypeOf).fields[0]);
    let read = name.read_of(operand);
    assert!(read.is_free_name && read.is_for_type_of, "{name}");
    name.expect_path(operand, &["probeTarget"]);
    assert_eq!(name.count(Opcode::PropGet), 1, "{name}");

    let path = lower_body(PATHS, "return typeof PROBE_PATH;");
    let operand = ValueId::from_word(path.only(Opcode::TypeOf).fields[0]);
    path.expect_path(operand, &["probeHolder", "inner", "member"]);
    assert_eq!(path.count(Opcode::PropGet), 3, "{path}");
    assert!(
        path.reads().iter().all(|read| !read.is_for_type_of),
        "{path}"
    );
}

#[test]
fn typeof_defined_builtin() {
    let predicted = lower_body(BUILTINS, "return typeof PROBE_CONSOLE;");
    let operand = ValueId::from_word(predicted.only(Opcode::TypeOf).fields[0]);
    let conversions = predicted.all(Opcode::Convert);
    let prediction = conversions
        .iter()
        .find(|conversion| conversion.id == operand);
    let prediction =
        *prediction.unwrap_or_else(|| panic!("no Convert defines {operand}:\n{predicted}"));
    predicted.expect_prediction(prediction, BuiltinId::Console);
    assert!(predicted.read_of(operand).is_for_type_of, "{predicted}");

    let locked = lower_body(BUILTINS, "return typeof PROBE_SYMBOL;");
    let operand = ValueId::from_word(locked.only(Opcode::TypeOf).fields[0]);
    locked.expect_builtin(operand, BuiltinId::Symbol);
    assert_eq!(locked.count(Opcode::PropGet), 0, "{locked}");
}

#[test]
fn in_with_defined_key() {
    let defines = [
        ("PROBE_KEY", DefinedValue::String("k")),
        ("PROBE_NUMBER", DefinedValue::Number(1.0)),
    ];
    let named = lower_body(&defines, "return PROBE_KEY in a;");
    let &[object, key] = named.only(Opcode::PropHas).fields else {
        panic!("a PropHas has an object and a key:\n{named}");
    };
    named.expect_parameter(ValueId::from_word(object));
    assert_eq!(
        named.key_text(PropertyKeyId::from_word(key)),
        "k",
        "{named}"
    );
    for opcode in [Opcode::ElemHas, Opcode::PropGet, Opcode::String] {
        assert_eq!(named.count(opcode), 0, "{named}");
    }

    let number = lower_body(&defines, "return PROBE_NUMBER in a;");
    let &[object, property] = number.only(Opcode::ElemHas).fields else {
        panic!("an ElemHas has an object and a property:\n{number}");
    };
    number.expect_parameter(ValueId::from_word(object));
    assert_eq!(
        number.integer_of(ValueId::from_word(property)),
        Some(1),
        "{number}"
    );
    for opcode in [Opcode::PropHas, Opcode::PropGet] {
        assert_eq!(number.count(opcode), 0, "{number}");
    }

    let other = lower_body(&defines, "return OTHER_KEY in a;");
    let &[_, property] = other.only(Opcode::ElemHas).fields else {
        panic!("an ElemHas has an object and a property:\n{other}");
    };
    other.expect_path(ValueId::from_word(property), &["OTHER_KEY"]);
    assert_eq!(other.count(Opcode::PropHas), 0, "{other}");
}

#[test]
fn delete_defined_member() {
    let defines = [("process.env.NODE_ENV", DefinedValue::String("production"))];
    let defined = lower_body(&defines, "return delete process.env.NODE_ENV;");
    let returned = defined.definition(defined.returned());
    assert_eq!(
        (returned.opcode, returned.fields),
        (Opcode::Boolean, &[1][..]),
        "{defined}"
    );
    for opcode in [
        Opcode::PropDelete,
        Opcode::PropGet,
        Opcode::Builtin,
        Opcode::String,
    ] {
        assert_eq!(defined.count(opcode), 0, "{defined}");
    }

    let other = lower_body(&defines, "return delete process.env.OTHER;");
    let deleted = decode_delete(other.definition(other.returned()));
    assert_eq!(other.key_text(deleted.key), "OTHER", "{other}");
    let holder = decode_read(other.definition(deleted.object));
    assert_eq!(other.key_text(holder.key), "env", "{other}");
    assert_eq!(
        other.builtin_of(holder.object),
        Some(BuiltinId::Process),
        "{other}"
    );
    assert!(!deleted.is_free_name, "{other}");
    assert_eq!(other.count(Opcode::Boolean), 0, "{other}");
}

#[test]
fn delete_defined_path() {
    let defines = [
        ("process.env.ALIAS", GlobalPath("probeHolder.inner.member")),
        ("process.env.RENAMED", GlobalPath("probeTarget")),
    ];
    let path = lower_body(&defines, "return delete process.env.ALIAS;");
    let deleted = decode_delete(path.definition(path.returned()));
    assert_eq!(path.key_text(deleted.key), "member", "{path}");
    path.expect_path(deleted.object, &["probeHolder", "inner"]);
    assert!(!deleted.is_free_name, "{path}");
    assert_eq!(deleted.mode, ECMAMode::Strict, "{path}");
    assert_eq!(path.count(Opcode::PropGet), 2, "{path}");
    assert_eq!(path.count(Opcode::Boolean), 0, "{path}");

    let name = lower_body(&defines, "return delete process.env.RENAMED;");
    let deleted = decode_delete(name.definition(name.returned()));
    assert_eq!(name.key_text(deleted.key), "probeTarget", "{name}");
    name.expect_builtin(deleted.object, BuiltinId::GlobalThis);
    assert!(deleted.is_free_name, "{name}");
    assert_eq!(name.count(Opcode::PropGet), 0, "{name}");

    let sloppy = lower_sloppy_body(&defines, "return delete process.env.ALIAS;");
    let deleted = decode_delete(sloppy.definition(sloppy.returned()));
    assert_eq!(deleted.mode, ECMAMode::Sloppy, "{sloppy}");
}

#[test]
fn delete_defined_path_below_a_binding() {
    let defines = [
        ("process.env.ALIAS", GlobalPath("probeHolder.inner.member")),
        ("process.env.RENAMED", GlobalPath("probeTarget")),
    ];
    let body = "return delete process.env.ALIAS;";
    let path = lower_with_parameter(&defines, "probeHolder", body);
    let deleted = decode_delete(path.definition(path.returned()));
    assert_eq!(path.key_text(deleted.key), "member", "{path}");
    let holder = path.path_below_parameter(deleted.object);
    assert_eq!(holder, ["inner"], "{path}");
    assert!(!deleted.is_free_name, "{path}");
    assert_eq!(path.count(Opcode::PropGet), 1, "{path}");

    let source =
        "module.exports = function probe(probeTarget) { return delete process.env.RENAMED; };";
    let sloppy = lower_file(&defines, "main.cjs", source);
    let returned = sloppy.definition(sloppy.returned());
    assert_eq!(
        (returned.opcode, returned.fields),
        (Opcode::Boolean, &[0][..]),
        "{sloppy}"
    );
    assert_eq!(sloppy.count(Opcode::PropDelete), 0, "{sloppy}");

    let source = "export function probe(probeTarget) { return delete process.env.RENAMED; }";
    let found = collect_stops(&defines, &[("main.js", source)]);
    let texts: Vec<BString> = found.into_iter().map(|(_, text)| text).collect();
    let reason = "process.env.RENAMED is deleted in strict mode";
    let expected = stop_text("process.env.RENAMED", "probeTarget", reason);
    assert_eq!(texts, [expected]);
}

#[track_caller]
fn lower_defined_callee(path: &'static str) -> (Probe, CallOperation) {
    let defines = [("settle", GlobalPath(path))];
    let probe = lower_body(&defines, "return settle(1);");
    let call = decode_call(probe.only(Opcode::Call));
    (probe, call)
}

#[test]
fn defined_global_path_callee() {
    let (member, call) = lower_defined_callee("probeHolder.inner.member");
    member.expect_path(call.callee, &["probeHolder", "inner", "member"]);
    let this = call.this.expect("the holder of the member is the receiver");
    assert_eq!(member.read_of(call.callee).object, this, "{member}");
    assert_eq!(
        call.key.map(|key| member.key_text(key)),
        Some(BStr::new("member")),
        "{member}"
    );
    assert_eq!(
        call.name.map(|name| member.string_text(name)),
        Some(BStr::new("member"))
    );
    assert_eq!(member.count(Opcode::PropGet), 3, "{member}");

    let (global, call) = lower_defined_callee("probeTarget");
    global.expect_path(call.callee, &["probeTarget"]);
    assert_eq!((call.this, call.key), (None, None), "{global}");
    assert_eq!(
        call.name.map(|name| global.string_text(name)),
        Some(BStr::new("probeTarget"))
    );
    assert!(!global.names_text("settle"), "{global}");
}

#[test]
fn defined_builtin_callee() {
    let (locked, call) = lower_defined_callee("Symbol.for");
    locked.expect_builtin(call.callee, BuiltinId::SymbolFor);
    let this = call.this.expect("the holder of the member is the receiver");
    locked.expect_path(this, &["Symbol"]);
    assert_eq!(call.key, None, "{locked}");
    assert_eq!(
        call.name.map(|name| locked.string_text(name)),
        Some(BStr::new("for"))
    );
    assert_eq!(locked.count(Opcode::PropGet), 1, "{locked}");

    let (predicted, call) = lower_defined_callee("Promise.resolve");
    let prediction = predicted.only(Opcode::Convert);
    assert_eq!(call.callee, prediction.id, "{predicted}");
    predicted.expect_prediction(prediction, BuiltinId::PromiseResolve);
    predicted.expect_path(call.callee, &["Promise", "resolve"]);
    let this = call.this.expect("the holder of the member is the receiver");
    predicted.expect_path(this, &["Promise"]);
    let key = call.key.map(|key| predicted.key_text(key));
    assert_eq!(key, Some(BStr::new("resolve")), "{predicted}");

    let (global, call) = lower_defined_callee("fetch");
    let prediction = global.only(Opcode::Convert);
    assert_eq!(call.callee, prediction.id, "{global}");
    global.expect_prediction(prediction, BuiltinId::Fetch);
    global.expect_path(call.callee, &["fetch"]);
    assert_eq!((call.this, call.key), (None, None), "{global}");
}

#[test]
fn defined_callee_is_the_binding_in_scope() {
    let defines = [
        ("settle", GlobalPath("probeTarget")),
        ("settleBelow", GlobalPath("probeHolder.inner.member")),
    ];
    let name = lower_with_parameter(&defines, "probeTarget", "return settle(1);");
    let call = decode_call(name.only(Opcode::Call));
    name.expect_parameter(call.callee);
    assert_eq!((call.this, call.key), (None, None), "{name}");
    assert_eq!(
        call.name.map(|text| name.string_text(text)),
        Some(BStr::new("probeTarget"))
    );
    assert!(!name.names_text("settle"), "{name}");
    assert_eq!(name.count(Opcode::PropGet), 0, "{name}");

    let member = lower_with_parameter(&defines, "probeHolder", "return settleBelow(1);");
    let call = decode_call(member.only(Opcode::Call));
    let path = member.path_below_parameter(call.callee);
    assert_eq!(path, ["inner", "member"], "{member}");
    let this = call.this.expect("the holder of the member is the receiver");
    assert_eq!(member.read_of(call.callee).object, this, "{member}");
    assert_eq!(member.path_below_parameter(this), ["inner"], "{member}");
    assert_eq!(member.count(Opcode::PropGet), 2, "{member}");
}

#[test]
fn free_name_is_property_of_global_object() {
    let read = lower_body(&[], "return probeFree;");
    read.expect_path(read.returned(), &["probeFree"]);
    assert!(!read.read_of(read.returned()).is_for_type_of, "{read}");

    let tested = lower_body(&[], "return typeof probeFree;");
    let operand = ValueId::from_word(tested.only(Opcode::TypeOf).fields[0]);
    tested.expect_path(operand, &["probeFree"]);
    assert!(tested.read_of(operand).is_for_type_of, "{tested}");

    let written = lower_sloppy_body(&[], "probeFree = a; return delete probeFree;");
    let store = written.only_store();
    assert!(store.is_free_name, "{written}");
    written.expect_builtin(store.object, BuiltinId::GlobalThis);
    assert_eq!(written.key_text(store.key), "probeFree", "{written}");
    assert_eq!(store.mode, ECMAMode::Sloppy, "{written}");
    written.expect_parameter(store.value);

    let deleted = decode_delete(written.definition(written.returned()));
    assert!(deleted.is_free_name, "{written}");
    written.expect_builtin(deleted.object, BuiltinId::GlobalThis);
    assert_eq!(written.key_text(deleted.key), "probeFree", "{written}");
    assert_eq!(deleted.mode, ECMAMode::Sloppy, "{written}");

    let member = lower_body(&[], "return a.probeFree;");
    assert!(!member.read_of(member.returned()).is_free_name, "{member}");
}

#[test]
fn call_of_eval_or_require_through_a_define_stops_the_build() {
    let defines = [
        ("RUN", GlobalPath("eval")),
        ("process.env.RUN", GlobalPath("eval")),
        ("REQ", GlobalPath("require")),
    ];
    let called = stop_text("RUN", "eval", "RUN is called");
    let body = "return [RUN(a), (0, RUN)(a), RUN?.(a), RUN, typeof RUN, process.env.RUN(a)];";
    let source = format!("export function probe(a) {{ {body} }}");
    let expected = (offset_of(&source, "RUN(a)"), called.clone());
    let found = collect_stops(&defines, &[("main.js", source.as_str())]);
    assert_eq!(found, [expected]);

    // Where a parameter named eval holds the function eval, a call of that name is a direct eval.
    let source = "module.exports = function probe(eval, a) { return RUN(a); };";
    let expected = (offset_of(source, "RUN(a)"), called);
    assert_eq!(collect_stops(&defines, &[("main.cjs", source)]), [expected]);

    let source = "module.exports = function probe(a) { return [typeof REQ, REQ(a)]; };";
    let called = stop_text("REQ", "require", "REQ is called");
    let expected = (offset_of(source, "REQ(a)"), called);
    assert_eq!(collect_stops(&defines, &[("main.cjs", source)]), [expected]);
}

#[test]
fn store_to_a_name_of_commonjs_through_a_define_stops_the_build() {
    let defines = [("EXP", GlobalPath("exports"))];
    let source = "module.exports = function probe(a) { EXP = a; };";
    let stored = stop_text("EXP", "exports", "EXP is stored to");
    let expected = (offset_of(source, "EXP = a"), stored);
    assert_eq!(collect_stops(&defines, &[("main.cjs", source)]), [expected]);

    let source = "module.exports = function probe(exports) { EXP = 1; return exports; };";
    assert_eq!(collect_stops(&defines, &[("main.cjs", source)]), []);
    let parameter = lower_file(&defines, "main.cjs", source);
    let returned = parameter.integer_of(parameter.returned());
    assert_eq!(returned, Some(1), "{parameter}");
}

#[test]
fn defined_path_below_a_name_that_plain_bun_may_remove_stops_the_build() {
    let (key, value) = ("ALIAS_PATH", "probeHolder.member");
    let reason = "\"probeHolder\" is a let or const that is not at the top level of the file";
    for keyword in ["const", "let"] {
        let body = format!("{keyword} probeHolder = a; return ALIAS_PATH;");
        let source = format!("export function probe(a) {{ {body} }}");
        let expected = (
            offset_of(&source, "ALIAS_PATH"),
            stop_text(key, value, reason),
        );
        let found = collect_stops(RENAMED, &[("main.js", source.as_str())]);
        assert_eq!(found, [expected], "{source}");
    }

    let source = "export function probe(a) { var probeHolder = a; return ALIAS_PATH; }";
    assert_eq!(collect_stops(RENAMED, &[("main.js", source)]), []);
    let of_var = lower_file(RENAMED, "main.js", source);
    let path = of_var.path_below_parameter(of_var.returned());
    assert_eq!(path, ["member"], "{of_var}");

    let library = ("lib.ts", "export const probeHolder = { member: 1 };");
    let source = "import { probeHolder } from \"./lib\"; declare const ALIAS_PATH: number; \
                  export function probe() { return ALIAS_PATH; }";
    let reason = "\"probeHolder\" is an import that the file uses nowhere else";
    let expected = (
        offset_of(source, "ALIAS_PATH; }"),
        stop_text(key, value, reason),
    );
    let found = collect_stops(RENAMED, &[("main.ts", source), library]);
    assert_eq!(found, [expected]);

    let source = "import { probeHolder } from \"./lib\"; declare const ALIAS_PATH: number; \
                  export function probe() { return [ALIAS_PATH, probeHolder]; }";
    assert_eq!(collect_stops(RENAMED, &[("main.ts", source), library]), []);
}

#[test]
fn defined_name_of_a_declaration_that_never_runs_stops_the_build() {
    let never_runs = "is a let, const, class or enum in code that never runs";
    let reason = format!("\"probeTarget\" {never_runs}");
    let removed = [
        "const probeTarget = a;",
        "let probeTarget = a;",
        "class probeTarget {}",
    ];
    for declaration in removed {
        let source = format!("export function probe(a) {{ return ALIAS_NAME; {declaration} }}");
        let expected = (
            offset_of(&source, "ALIAS_NAME"),
            stop_text("ALIAS_NAME", "probeTarget", &reason),
        );
        let found = collect_stops(RENAMED, &[("main.js", source.as_str())]);
        assert_eq!(found, [expected], "{source}");
    }

    let (key, value) = ("ALIAS_PATH", "probeHolder.member");
    let source = "export function probe(a) { return ALIAS_PATH; class probeHolder {} }";
    let reason = format!("\"probeHolder\" {never_runs}");
    let expected = (
        offset_of(source, "ALIAS_PATH"),
        stop_text(key, value, &reason),
    );
    assert_eq!(collect_stops(RENAMED, &[("main.js", source)]), [expected]);

    // Below a dotted value a `let` or a `const` of a function stops the build wherever it is declared.
    let source = "export function probe(a) { return ALIAS_PATH; const probeHolder = a; }";
    let reason = "\"probeHolder\" is a let or const that is not at the top level of the file";
    let expected = (
        offset_of(source, "ALIAS_PATH"),
        stop_text(key, value, reason),
    );
    assert_eq!(collect_stops(RENAMED, &[("main.js", source)]), [expected]);

    // `bun run` keeps what declares a `var` or a function behind a `return`.
    let kept = [
        "return ALIAS_NAME; var probeTarget = a;",
        "return ALIAS_NAME; function probeTarget() {}",
        "const probeTarget = a; return ALIAS_NAME;",
    ];
    for body in kept {
        let source = format!("export function probe(a) {{ {body} }}");
        let found = collect_stops(RENAMED, &[("main.js", source.as_str())]);
        assert_eq!(found, [], "{source}");
    }
}

// The transpiler of these tests is not told the defines: where `bun run` prints the value of a define, it prints the defined name.
#[test]
fn defined_name_of_a_declaration_that_bun_run_removes_stops_the_build() {
    let reason = "\"probeTarget\" is a let, const, class or enum in code that never runs";
    let stop = stop_text("ALIAS_NAME", "probeTarget", reason);

    // `bun run` decides the test of the `if`, and the fold does not.
    let removed = [
        "const probeTarget = a;",
        "let probeTarget = a;",
        "class probeTarget {}",
    ];
    for declaration in removed {
        let body = format!("if (typeof a) return ALIAS_NAME; {declaration}");
        let source = format!("export function probe(a) {{ {body} }}");
        let expected = (offset_of(&source, "ALIAS_NAME"), stop.clone());
        let found = collect_stops(RENAMED, &[("main.js", source.as_str())]);
        assert_eq!(found, [expected], "{source}");
    }
    let source = "export function probe(a) { if (a) return ALIAS_NAME; const probeTarget = a; }";
    assert_eq!(collect_stops(RENAMED, &[("main.js", source)]), []);

    // `bun run` declares the enums of one name in a function with one `let`, at the first of them.
    let typed = |body: &str| {
        format!("declare const ALIAS_NAME: unknown; export function probe() {{ {body} }}")
    };
    let source = typed("return ALIAS_NAME; enum probeTarget { A }");
    let expected = (offset_of(&source, "ALIAS_NAME; enum"), stop.clone());
    let found = collect_stops(RENAMED, &[("main.ts", source.as_str())]);
    assert_eq!(found, [expected], "{source}");
    let kept = [
        "enum probeTarget { A } return typeof ALIAS_NAME;",
        "enum probeTarget { A } return typeof ALIAS_NAME; enum probeTarget { B = 1 }",
    ];
    for body in kept {
        let source = typed(body);
        let found = collect_stops(RENAMED, &[("main.ts", source.as_str())]);
        assert_eq!(found, [], "{source}");
    }

    // The fold finds no code that never runs in the body of a namespace.
    let body = "export const seen = ALIAS_NAME; throw 0; const probeTarget = 1;";
    let source =
        format!("declare const ALIAS_NAME: unknown; export namespace probeSpace {{ {body} }}");
    let expected = (offset_of(&source, "ALIAS_NAME; throw"), stop);
    let found = collect_stops(RENAMED, &[("main.ts", source.as_str())]);
    assert_eq!(found, [expected], "{source}");
}

#[test]
fn defined_name_after_a_direct_eval_is_looked_up_as_the_name_written_there() {
    let rows = [
        ("a", "return PROBE_NAME;", "return probeTarget;"),
        (
            "a",
            "return typeof PROBE_NAME;",
            "return typeof probeTarget;",
        ),
        ("a", "return PROBE_NAME(a);", "return probeTarget(a);"),
        ("a", "PROBE_NAME = a;", "probeTarget = a;"),
        // Beside a parameter with a default value, the variables of text evaluated in the body lie inside the parameters.
        (
            "a, probeTarget = 1",
            "return PROBE_NAME;",
            "return probeTarget;",
        ),
    ];
    for (parameters, defined, written) in rows {
        let lower = |body: &str| {
            let head = format!("module.exports = function probe({parameters})");
            lower_file(PATHS, "main.cjs", &format!("{head} {{ eval(a); {body} }};"))
        };
        let (defined, written) = (lower(defined), lower(written));
        assert_ne!(defined.count(Opcode::ScopeHasBinding), 0, "{defined}");
        let lookups = [
            Opcode::ScopeHasBinding,
            Opcode::PropGet,
            Opcode::PropHas,
            Opcode::PropSet,
        ];
        for opcode in lookups {
            let (found, expected) = (defined.count(opcode), written.count(opcode));
            assert_eq!(found, expected, "{defined}\n{written}");
        }
    }
}

// The defined name is as long as the name that the define gives it, so `probe` prints the same text in both forms where the store is the one that the name written by hand makes.
#[test]
fn store_to_defined_name_is_the_store_to_the_name_written_there() {
    const STORED: &[(&str, DefinedValue)] = &[("TARGET", GlobalPath("target"))];
    let rows = [
        (
            "let target = 0; for (let i = 0; i < a; i++) { TARGET += i; } return target;",
            "let target = 0; for (let i = 0; i < a; i++) { target += i; } return target;",
        ),
        (
            "let target = 0; for (const item of a) { TARGET++; } return target;",
            "let target = 0; for (const item of a) { target++; } return target;",
        ),
        (
            "let target = 0; while (target < 3) { TARGET = target + 1; } return target;",
            "let target = 0; while (target < 3) { target = target + 1; } return target;",
        ),
        (
            "let target = 0; try { TARGET = 1; a(); } catch { return target; } return target;",
            "let target = 0; try { target = 1; a(); } catch { return target; } return target;",
        ),
        (
            "let target = 0; function inner() { TARGET = a; } inner(); return target;",
            "let target = 0; function inner() { target = a; } inner(); return target;",
        ),
        (
            "let target = 0; const write = () => { TARGET = a; }; const read = () => target; write(); return read();",
            "let target = 0; const write = () => { target = a; }; const read = () => target; write(); return read();",
        ),
        // The update is reported at the last position that was recorded, and the leaf of a pattern records none for a variable in a register.
        (
            "let target = 0; ({ x: TARGET } = a); target++; return target;",
            "let target = 0; ({ x: target } = a); target++; return target;",
        ),
    ];
    for (defined, written) in rows {
        let defined = lower_sloppy_body(STORED, defined);
        let written = lower_sloppy_body(&[], written);
        assert_eq!(defined.to_string(), written.to_string());
    }
}

mod calls;
mod control_flow;
mod keys;
mod likelihood;
mod misuses;
mod operations;

use core::fmt;

use bun_builtin_sources::{Archive, VIRTUAL_ROOT};
use bun_sema::program::FileId;

use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::compile::testing::lower_program;
use crate::ir::generated::{
    EntryParameter, Function, TerminatorKind, print_value_fields, visit_terminator_fields,
    visit_value_fields,
};
use crate::ir::{
    BlockId, BlockView, EntryPosition, FieldWord, FunctionId, Id, NameTables, Opcode,
    PositionFlags, Printer, PropertyKey, PropertyKeyId, Reference, StringId, TerminatorView,
    TypeId, TypeTable, ValueId, ValueView, WellKnownSymbol, print_function,
};
use crate::load::host_platform;
use crate::lower::{Fragment, LoweredFile, LoweringOptions};

const MODULE_IMPORTER: (&str, &str) = ("main.ts", "import \"node:os\";");
const MODULE_PATH: &str = "/$bun/js/node/os.ts";

struct LoweredFiles(Vec<(FileId, LoweredFile)>);

#[derive(Copy, Clone)]
struct Probe<'a> {
    fragment: &'a Fragment,
    id: FunctionId,
    function: &'a Function,
}

#[derive(Copy, Clone)]
struct Operation<'a> {
    probe: Probe<'a>,
    block: BlockId,
    value: ValueView<'a>,
}

fn lower_files(files: &[(&str, &str)]) -> LoweredFiles {
    let options = LoweringOptions {
        platform: host_platform(),
        embeds_function_text: false,
        reports_type_mismatches: false,
        removable: Default::default(),
        minifies_identifiers: false,
    };
    LoweredFiles(lower_program(files, options))
}

fn lower_runtime_module(source: &str) -> LoweredFiles {
    lower_files(&[MODULE_IMPORTER, (MODULE_PATH, source)])
}

fn find_library_path(export_name: &str) -> String {
    let mut functions = table::runtime_functions().iter();
    let function = functions.find(|function| function.export_name == export_name);
    let function = function
        .expect("the built-ins table lists the function")
        .function;
    let archive_name = Archive::embedded().manifest().function_file(function.0);
    let archive_name = archive_name.expect("the manifest lists the file of the function");
    let path = [VIRTUAL_ROOT, archive_name].concat();
    str::from_utf8(&path)
        .expect("archive names are ASCII")
        .to_owned()
}

fn name_tables(fragment: &Fragment) -> NameTables<'_> {
    NameTables {
        strings: &fragment.strings,
        property_keys: &fragment.property_keys,
        types: &fragment.types,
    }
}

fn is_expected_conversion(value: ValueView<'_>) -> bool {
    let (Opcode::Convert, &[_, _, _, flags, _]) = (value.opcode, value.fields) else {
        return false;
    };
    PositionFlags(flags).contains(PositionFlags::IS_EXPECTED)
}

fn terminator_operands(terminator: TerminatorView<'_>) -> Vec<ValueId> {
    let fields = terminator.fields;
    let mut operands = Vec::new();
    visit_terminator_fields(terminator.kind, fields, 0, &mut |field, at| match field {
        FieldWord::Operand => operands.push(ValueId::from_word(fields[at])),
        FieldWord::Reference(_) => {}
    });
    operands
}

impl LoweredFiles {
    fn files(&self) -> impl Iterator<Item = &LoweredFile> {
        self.0.iter().map(|(_, lowered)| lowered)
    }

    #[track_caller]
    fn function(&self, name: &str) -> Probe<'_> {
        let fragments = self.files().map(|lowered| &lowered.fragment);
        let mut probes = fragments.flat_map(|fragment| {
            let functions = fragment.functions.iter();
            functions.map(move |(id, function)| Probe {
                fragment,
                id: *id,
                function,
            })
        });
        let probe = probes.find(|probe| {
            let text = probe
                .function
                .name
                .map(|name| probe.fragment.strings.get(name));
            text == Some(name.as_bytes())
        });
        probe.unwrap_or_else(|| panic!("no fragment defines a function named {name}"))
    }
}

impl fmt::Display for Probe<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut text = String::new();
        print_function(
            name_tables(self.fragment),
            self.id,
            self.function,
            &mut text,
        );
        formatter.write_str(&text)
    }
}

impl<'a> Probe<'a> {
    fn blocks(self) -> impl Iterator<Item = BlockView<'a>> {
        self.function.body.blocks()
    }

    #[track_caller]
    fn block(self, id: BlockId) -> BlockView<'a> {
        let block = self.blocks().find(|block| block.id == id);
        block.unwrap_or_else(|| panic!("no block {id}:\n{self}"))
    }

    fn operations(self) -> impl Iterator<Item = Operation<'a>> {
        self.blocks().flat_map(move |block| {
            block.values().map(move |value| Operation {
                probe: self,
                block: block.id,
                value,
            })
        })
    }

    fn all(self, opcode: Opcode) -> Vec<Operation<'a>> {
        let operations = self.operations();
        operations
            .filter(|operation| operation.value.opcode == opcode)
            .collect()
    }

    fn count(self, opcode: Opcode) -> usize {
        self.all(opcode).len()
    }

    #[track_caller]
    fn only(self, opcode: Opcode) -> Operation<'a> {
        let [operation] = self.all(opcode)[..] else {
            panic!("expected one {}:\n{self}", opcode.name());
        };
        operation
    }

    #[track_caller]
    fn only_builtin(self, builtin: BuiltinId) -> Operation<'a> {
        let found = self.only(Opcode::Builtin);
        assert_eq!(found.references(), [Reference::Builtin(builtin)], "{self}");
        found
    }

    #[track_caller]
    fn definition(self, value: ValueId) -> Operation<'a> {
        let operation = self.operations().find(|operation| operation.id() == value);
        operation.unwrap_or_else(|| panic!("no operation defines {value}:\n{self}"))
    }

    #[track_caller]
    fn call_of(self, callee: ValueId) -> Operation<'a> {
        let mut calls = self.all(Opcode::Call);
        calls.retain(|call| call.operands().first() == Some(&callee));
        let [call] = calls[..] else {
            panic!("expected one call of {callee}:\n{self}");
        };
        call
    }

    fn parameter(self, index: u32) -> ValueId {
        let position = EntryPosition::new(EntryParameter::Parameter, index);
        let index = self.function.entry_parameter_index(position);
        ValueId::new(index.expect("the function declares the parameter"))
    }

    fn demanded_conversions(self) -> Vec<Operation<'a>> {
        let mut conversions = self.all(Opcode::Convert);
        conversions.retain(|conversion| !is_expected_conversion(conversion.value));
        conversions
    }

    #[track_caller]
    fn only_demanded_conversion(self) -> Operation<'a> {
        let [conversion] = self.demanded_conversions()[..] else {
            panic!("expected one conversion that is not only expected:\n{self}");
        };
        conversion
    }

    fn skip_expected_types(self, value: ValueId) -> ValueId {
        let values = self.blocks().flat_map(|block| block.values());
        let conversion = values
            .filter(|&candidate| is_expected_conversion(candidate))
            .find(|candidate| candidate.id == value);
        match conversion {
            Some(conversion) => self.skip_expected_types(ValueId::from_word(conversion.fields[0])),
            None => value,
        }
    }

    fn skip_requests(self, value: ValueId) -> ValueId {
        let request = self
            .operations()
            .find(|operation| operation.value.opcode == Opcode::Convert && operation.id() == value);
        match request {
            Some(request) => self.skip_requests(request.operands()[0]),
            None => value,
        }
    }

    fn terminators(self, kind: TerminatorKind) -> Vec<(BlockView<'a>, TerminatorView<'a>)> {
        let terminators = self.blocks().map(|block| (block, block.terminator()));
        terminators
            .filter(|(_, terminator)| terminator.kind == kind)
            .collect()
    }

    #[track_caller]
    fn only_terminator(self, kind: TerminatorKind) -> (BlockView<'a>, TerminatorView<'a>) {
        let [terminator] = self.terminators(kind)[..] else {
            panic!("expected one {}:\n{self}", kind.name());
        };
        terminator
    }

    #[track_caller]
    fn branch_targets(self, test: Operation<'a>) -> [BlockView<'a>; 2] {
        let branch = self.block(test.block).terminator();
        assert_eq!(branch.kind, TerminatorKind::Branch, "{self}");
        assert_eq!(terminator_operands(branch), [test.id()], "{self}");
        let targets: Vec<BlockView<'a>> = branch
            .targets()
            .map(|target| self.block(target.block))
            .collect();
        let [taken, not_taken] = targets[..] else {
            panic!("a branch has two targets:\n{self}");
        };
        [taken, not_taken]
    }

    #[track_caller]
    fn value_unless_nullish(self, tested: ValueId) -> ValueId {
        let test = self.only(Opcode::TypeTest);
        assert_eq!(test.operands(), [tested], "{self}");
        assert_eq!(test.types(), [TypeTable::NULLISH], "{self}");
        let [_, not_taken] = self.branch_targets(test);
        assert_eq!(not_taken.parameter_count(), 1, "{self}");
        not_taken.first_parameter
    }

    fn has_string(self, text: &str) -> bool {
        self.fragment.strings.find(text.as_bytes()).is_some()
    }

    #[track_caller]
    fn string(self, text: &str) -> StringId {
        let string = self.fragment.strings.find(text.as_bytes());
        string.unwrap_or_else(|| panic!("the fragment has no string {text:?}:\n{self}"))
    }

    #[track_caller]
    fn key(self, key: PropertyKey) -> PropertyKeyId {
        let found = self.fragment.property_keys.find(&key);
        found.unwrap_or_else(|| panic!("the fragment has no key {key:?}:\n{self}"))
    }

    #[track_caller]
    fn text_key(self, text: &str) -> PropertyKeyId {
        self.key(PropertyKey::from_text(self.string(text)))
    }

    #[track_caller]
    fn private_key(self, text: &str) -> PropertyKeyId {
        self.key(PropertyKey::from_engine_private_name(self.string(text)))
    }

    #[track_caller]
    fn symbol_key(self, symbol: WellKnownSymbol) -> PropertyKeyId {
        self.key(PropertyKey::from_well_known_symbol(symbol))
    }
}

impl Operation<'_> {
    fn id(&self) -> ValueId {
        self.value.id
    }

    // What the program passes. A type that is only expected of a value changes nothing about what an intrinsic takes.
    fn operands(&self) -> Vec<ValueId> {
        let fields = self.value.fields;
        let mut operands = Vec::new();
        visit_value_fields(self.value.opcode, fields, 0, &mut |field, at| match field {
            FieldWord::Operand => {
                let operand = ValueId::from_word(fields[at]);
                operands.push(self.probe.skip_expected_types(operand));
            }
            FieldWord::Reference(_) => {}
        });
        operands
    }

    fn references(&self) -> Vec<Reference> {
        let fields = self.value.fields;
        let mut references = Vec::new();
        visit_value_fields(self.value.opcode, fields, 0, &mut |field, at| match field {
            FieldWord::Operand => {}
            FieldWord::Reference(kind) => references.extend(Reference::from_word(kind, fields[at])),
        });
        references
    }

    fn keys(&self) -> Vec<PropertyKeyId> {
        let references = self.references().into_iter();
        let keys = references.filter_map(|reference| {
            let Reference::PropertyKey(key) = reference else {
                return None;
            };
            Some(key)
        });
        keys.collect()
    }

    fn types(&self) -> Vec<TypeId> {
        let references = self.references().into_iter();
        let types = references.filter_map(|reference| {
            let Reference::Type(ty) = reference else {
                return None;
            };
            Some(ty)
        });
        types.collect()
    }

    fn integer(&self) -> i64 {
        let (Opcode::Integer, &[low, high]) = (self.value.opcode, self.value.fields) else {
            panic!("{} is no integer", self.value.id);
        };
        (u64::from(low) | (u64::from(high) << 32)) as i64
    }

    fn text(&self) -> String {
        let mut text = String::from(self.value.opcode.name());
        let mut printer = Printer::new(name_tables(self.probe.fragment), &mut text);
        print_value_fields(self.value.opcode, self.value.fields, &mut printer);
        text
    }
}

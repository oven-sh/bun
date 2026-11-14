use std::sync::Arc;

use crate::compile::testing::lower_test_run;
use crate::ir::generated::visit_value_fields;
use crate::ir::{FieldWord, Opcode};
use crate::lower::{SharedTables, UnitTables};

fn count_operands_of_calls(files: &[(&str, &str)]) -> Vec<usize> {
    let lowered = lower_test_run(files);
    let mut tables: Vec<(Arc<SharedTables>, UnitTables)> = Vec::new();
    let mut counts = Vec::new();
    for (_, file) in &lowered {
        let shared = &file.fragment.tables;
        if !tables.iter().any(|(taken, _)| Arc::ptr_eq(taken, shared)) {
            tables.push((Arc::clone(shared), *shared.take()));
        }
        let mut taken = tables.iter();
        let found = taken.find(|(taken, _)| Arc::ptr_eq(taken, shared));
        let strings = &found.expect("the tables were taken above").1.strings;
        let functions = file.fragment.functions.iter().map(|(_, function)| function);
        let probes = functions.filter(|function| {
            function.name.map(|name| strings.get(name)) == Some(b"probe".as_slice())
        });
        let blocks = probes.flat_map(|probe| probe.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        for value in values.filter(|value| value.opcode == Opcode::Call) {
            let mut operands = 0;
            visit_value_fields(value.opcode, value.fields, 0, &mut |field, _| {
                operands += usize::from(matches!(field, FieldWord::Operand));
            });
            counts.push(operands);
        }
    }
    counts
}

#[test]
fn a_name_of_the_runner_called_under_a_with_has_the_object_as_this() {
    for (body, operands) in [
        ("with (object) { return [expect(1)]; }", 3),
        ("with (object) { return [expect?.(1)]; }", 3),
        ("with (object) { with (inner) { return [jest(1)]; } }", 3),
        ("with (object) { return [own(1)]; }", 3),
        ("return [expect(1)];", 2),
    ] {
        let text = format!("test('a', () => {{}});\nfunction probe(object, inner) {{ {body} }}\n");
        let counts = count_operands_of_calls(&[("a.test.cjs", &text)]);
        assert_eq!(counts, [operands], "{body}");
    }
    let test_file = "require('./helper.cjs');\ntest('starts', () => {});\n";
    let helper =
        "exports.probe = function probe(object) { with (object) { return [afterEach(1)]; } };\n";
    let files = [("a.test.cjs", test_file), ("helper.cjs", helper)];
    assert_eq!(count_operands_of_calls(&files), [3]);
}

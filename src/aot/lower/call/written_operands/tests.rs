use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::compile::testing::lower_program_replacing;
use crate::ir::Opcode;

const PROGRAM: &str = "export function set(a, b) { return new Set([a, b]); }
export function map(key, value) { return new Map([[key, value]]); }
export function entries(key, value) { return Object.fromEntries([[key, value]]); }
export function spread(first, second) { return [first, ...[second]]; }
";

// The operation that a function has only where the array of its text is made and iterated.
const FUNCTIONS: [(&str, Opcode); 4] = [
    ("set", Opcode::NewArray),
    ("map", Opcode::NewArray),
    ("entries", Opcode::NewArray),
    ("spread", Opcode::AppendSpread),
];

fn find_functions_that_iterate(replaced: BuiltinId) -> [bool; 4] {
    find_functions_that_iterate_with(&[replaced.to_wire()])
}

fn find_functions_that_iterate_with(replaced: &[u32]) -> [bool; 4] {
    let lowered = lower_program_replacing(&[("a.js", PROGRAM)], replaced);
    assert_eq!(lowered.len(), 1);
    let fragment = &lowered[0].1.fragment;
    let tables = fragment.tables.take();
    FUNCTIONS.map(|(name, opcode)| {
        let mut functions = fragment.functions.iter().map(|(_, function)| function);
        let function = functions.find(|function| {
            let text = function.name.map(|name| tables.strings.get(name));
            text == Some(name.as_bytes())
        });
        let function = function.expect("the fragment defines the function");
        let mut values = function.body.blocks().flat_map(|block| block.values());
        values.any(|value| value.opcode == opcode)
    })
}

#[test]
fn nothing_replaced() {
    assert_eq!(find_functions_that_iterate_with(&[]), [false; 4]);
}

#[test]
fn array_iterator_protocol_replaced() {
    let iterator = BuiltinId::ArrayPrototypeSymbolIterator;
    assert_eq!(find_functions_that_iterate(iterator), [true; 4]);
    assert_eq!(
        find_functions_that_iterate(table::canonical_id(iterator)),
        [true; 4]
    );
    assert_eq!(
        find_functions_that_iterate(BuiltinId::ArrayIteratorPrototypeNext),
        [true; 4]
    );
}

#[test]
fn collection_takes_what_is_written_as_it_is_made() {
    let program = "export function set(a, b) { return new Set([a(), b()]); }
export function map(a, b) { return new Map([[a(), 1], [b(), 2]]); }
";
    let lowered = lower_program_replacing(&[("a.js", program)], &[]);
    let fragment = &lowered[0].1.fragment;
    for (_, function) in fragment
        .functions
        .iter()
        .filter(|(_, function)| function.name.is_some())
    {
        let order: Vec<Opcode> = function
            .body
            .blocks()
            .flat_map(|block| block.values())
            .map(|value| value.opcode)
            .filter(|opcode| [Opcode::Construct, Opcode::Call].contains(opcode))
            .collect();
        let calls = [Opcode::Call; 4];
        assert_eq!(order[0], Opcode::Construct);
        assert_eq!(order[1..], calls);
    }
}

#[test]
fn method_of_one_collection_replaced() {
    assert_eq!(
        find_functions_that_iterate(BuiltinId::SetPrototypeAdd),
        [true, false, false, false]
    );
    assert_eq!(
        find_functions_that_iterate(BuiltinId::MapPrototypeSet),
        [false, true, false, false]
    );
}

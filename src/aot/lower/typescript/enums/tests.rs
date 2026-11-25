use crate::compile::testing::lower_program_below_object_prototype;
use crate::ir::Opcode;
use crate::ir::generated::DataNode;

const DECLARED: (&str, &str) = (
    "a.ts",
    "export function make() { enum State { Ready, Done } return State; }",
);
const PRINTED: (&str, &str) = (
    "a.js",
    "export function make() {
  var State;
  (function (State) { State[State[\"Ready\"] = 0] = \"Ready\"; State[State[\"Done\"] = 1] = \"Done\"; })(State || (State = {}));
  return State;
}",
);

fn defines_members(program: (&str, &str), names_on_object_prototype: &[&str]) -> bool {
    let lowered = lower_program_below_object_prototype(&[program], names_on_object_prototype);
    assert_eq!(lowered.len(), 1);
    let fragment = &lowered[0].1.fragment;
    let tables = fragment.tables.take();
    let mut functions = fragment.functions.iter().map(|(_, function)| function);
    let function = functions.find(|function| {
        let text = function.name.map(|name| tables.strings.get(name));
        text == Some(&b"make"[..])
    });
    let function = function.expect("the fragment defines the function");
    let has = |opcode: Opcode| {
        let mut values = function.body.blocks().flat_map(|block| block.values());
        values.any(|value| value.opcode == opcode)
    };
    let stores = has(Opcode::PropSet) || has(Opcode::ElemSet) || has(Opcode::Call);
    let is_record_with_members =
        |data: &DataNode| matches!(data, DataNode::Object { members, .. } if !members.is_empty());
    let is_born_as_data =
        (fragment.data.iter()).any(|(_, data)| is_record_with_members(&data.root));
    assert_ne!(
        has(Opcode::ElemDefine) || is_born_as_data,
        stores,
        "{}",
        program.0
    );
    !stores
}

#[test]
fn enum_is_born_with_its_members() {
    for program in [DECLARED, PRINTED] {
        assert!(defines_members(program, &[]), "{}", program.0);
        assert!(defines_members(program, &["Elsewhere"]), "{}", program.0);
    }
}

#[test]
fn member_whose_name_the_program_lays_on_object_prototype_is_stored() {
    for program in [DECLARED, PRINTED] {
        assert!(!defines_members(program, &["Ready"]), "{}", program.0);
        assert!(
            !defines_members(program, &["Elsewhere", "Done"]),
            "{}",
            program.0
        );
    }
}

use bun_sema::hir::EnumId;

use super::{KnownMemberValues, KnownObjects, Validity};
use crate::modules::testing::{file_named, member_named, with_graph, with_test_run_graph};
use crate::modules::{BindInput, ModuleGraph};

const STATES: &str = "export enum State { Ready = 3, Done = 4 }";
const READS: &str = "import { State } from './states.ts'; console.log(State.Ready, State.Done);";

fn ask(lays: &str) -> (bool, bool, bool) {
    let test_file = format!("{READS} {lays}");
    let files = [("a.test.ts", test_file.as_str()), ("states.ts", STATES)];
    with_test_run_graph(&files, |graph, input| {
        let values = KnownMemberValues::default();
        let members = KnownObjects::new(input.files, graph, &values);
        let reader = file_named(input, "a.test.ts");
        let is_known = |name: &str| {
            let access = member_named(input, reader, name);
            members.find_read(reader, access).is_some()
        };
        let states = file_named(input, "states.ts");
        let may_run_setter = members.stores_under_name_laid_on_object_prototype(states, EnumId(0));
        (is_known("Ready"), is_known("Done"), may_run_setter)
    })
}

#[test]
fn member_under_a_name_that_a_test_run_lays_on_object_prototype_is_read_off_the_object() {
    assert_eq!(ask(""), (true, true, false));
    assert_eq!(ask("Object.prototype.Early = 1;"), (true, true, false));
    assert_eq!(ask("Array.prototype.Ready = 1;"), (true, true, false));
    let setter = "Object.defineProperty(Object.prototype, 'Ready', { set(value) {} });";
    assert_eq!(ask(setter), (false, true, true));
    assert_eq!(ask("Object.prototype.Ready = 1;"), (false, true, true));
}

fn validity_of_read(graph: &ModuleGraph, input: &BindInput<'_, '_>, name: &str) -> Validity {
    let values = KnownMemberValues::default();
    let members = KnownObjects::new(input.files, graph, &values);
    let reader = file_named(input, "a.test.ts");
    let read = members.find_read(reader, member_named(input, reader, name));
    read.expect("the member is known").validity
}

fn is_read_off_object_behind(store: &str) -> bool {
    let reader = format!("{READS} {store}");
    let helper = "export function set(target: any, key: string) { target[key] = 9; } export const read = (target: any) => target.Ready;";
    let files = [
        ("a.test.ts", reader.as_str()),
        ("states.ts", STATES),
        ("helper.ts", helper),
    ];
    with_graph(&files, |graph, input| {
        validity_of_read(graph, input, "Ready") == Validity::WhileObjectIsNotHandedOn
    })
}

#[test]
fn members_of_enums_that_the_program_stores_into() {
    for store in [
        "(State as any).Ready = 9;",
        "(State as any)['Ready'] = 9;",
        "(State as any)[process.argv[2]] = 9;",
        "delete (State as any).Ready;",
        "(State as any).Done++;",
        "[(State as any).Ready] = [9];",
        "for ((State as any).Ready of [9]);",
        "Object.assign(State, { Ready: 9 });",
        "Object.defineProperty(State, 'Ready', { value: 9 });",
        "Reflect.set(State, process.argv[2], 9);",
        "const held: any = State; held.Ready = 9;",
        "let held: any; held = process.argv[2] ? State : {}; held.Ready = 9;",
        "function set(held: any = State) { held.Ready = 9; } set();",
        "function set(held: any) { const again = held; again.Ready = 9; } set(State);",
        "(function (held: any) { held.Ready = 9; })(State);",
        "import { set } from './helper'; set(State, 'Ready');",
        "import * as helpers from './helper'; helpers.set(State, 'Ready');",
        "import * as all from './states'; (all.State as any).Ready = 9;",
    ] {
        assert!(is_read_off_object_behind(store), "{store}");
    }
    for read in [
        "console.log(Object.values(State), { ...State });",
        "(State as any).Later = 9;",
        "Object.assign({}, State);",
        "const held: any = { ...State }; held.Ready = 9;",
        "import { read } from './helper'; read(State);",
    ] {
        assert!(!is_read_off_object_behind(read), "{read}");
    }
}

#[test]
fn foreign_members_in_test_runs() {
    let own = "enum Own { Here = 1 } console.log(Own.Here);";
    let reader = format!("{READS} {own}");
    let files = [("a.test.ts", reader.as_str()), ("states.ts", STATES)];
    with_test_run_graph(&files, |graph, input| {
        let of_other_file = validity_of_read(graph, input, "Ready");
        assert_eq!(of_other_file, Validity::WhileObjectIsNotHandedOn);
        assert_eq!(validity_of_read(graph, input, "Here"), Validity::Always);
    });
    with_graph(&files, |graph, input| {
        assert_eq!(validity_of_read(graph, input, "Ready"), Validity::Always);
        assert_eq!(validity_of_read(graph, input, "Here"), Validity::Always);
    });
}

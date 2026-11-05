use bun_sema::hir::EnumId;

use super::{KnownMemberValues, KnownObjects};
use crate::modules::testing::{file_named, member_named, with_test_run_graph};

const STATES: &str = "export enum State { Ready = 3, Done = 4 }";
const READS: &str = "import { State } from './states.ts'; console.log(State.Ready, State.Done);";

// Whether the build has the value of `State.Ready` and of `State.Done` in the test file, and whether the declaration may store under a name that lies above the enum.
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

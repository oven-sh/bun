// A file that runs again keeps what it does not export in an environment of the run, and `hoisted` names `kept`, so its closure holds that environment.
// other.ts imports `hoisted` in a cycle and its body runs first. JavaScript has made the function by then: it makes what a module declares when the graph is linked.
// So a function of the file makes the environment and the closure, whoever comes first calls it, and the body takes what it has made.
// If the body made them, `hoisted` would be nothing while the body of other.ts runs.
// RUN: link
// OPTIONS: entry-points-run-again
// other.ts runs once and has nothing to make, and its body begins with the same call: its function calls that of main.ts, as the link goes through the graph.
// CHECK: variable [[hoisted]] name="hoisted"
// CHECK: function {{*}}kind=Module
// CHECK: CallDirect function=[[of_other]]
// CHECK: GetModuleVariable variable=[[hoisted]]
// CHECK: Return
// CHECK: function [[of_other]] module
// CHECK-NOT: NewObject
// CHECK: CallDirect function=[[of_main]]
// CHECK: function {{*}}kind=Module
// CHECK-NOT: NewClosure
// CHECK: CallDirect function=[[of_main]]
// CHECK-NOT: NewClosure
// CHECK: Return
// CHECK: function [[of_main]] module
// CHECK: [[environment]] = NewObject
// CHECK: [[closure]] = NewClosure [[environment]]
// CHECK: PutModuleVariable {{*}}variable=[[hoisted]]
// CHECK: PutModuleVariable [[environment]]
// CHECK: CallDirect function=[[of_other]]

// FILE: main.ts
import { early } from "./other";
const kept = 1;
export function hoisted(): number { return kept; }
console.log(typeof early);

// FILE: other.ts
import { hoisted } from "./main";
export const early = hoisted;

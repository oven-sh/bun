// The record that `Object.create(null)` makes for a maker at the top of a file has a layout of the call's own, and that layout lists the names under which the statements behind the call store on it, taken or not.
// RUN: link
// CHECK: layout [[listed]] {{*}}fields=[{key="first" {{*}}{key="inABranch" {{*}}{key="second"
// CHECK: function {{*}}kind=Module
// CHECK: = NewObject layout=[[listed]]
const namespace = Object.create(null);
namespace.second = 2;
namespace.first = 1;
if (globalThis.process) namespace.inABranch = 3;
namespace.first = 4;
export { namespace };

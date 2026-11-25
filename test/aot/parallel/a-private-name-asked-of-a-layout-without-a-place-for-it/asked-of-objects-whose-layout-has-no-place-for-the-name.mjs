// `#x in o` of a compiled object hangs on the object's layout alone where nothing was stamped onto it. The run time found that out anew at every question: about 330 instructions.
// It lays a row into the table of places of private fields now, and the question is answered in front of the operation: one call for each pair of a layout and a name.
// COUNTER: operationAOTPrivateHas <= 12
class P { #x = 1; #y = 2; static x(o) { return #x in o; } static y(o) { return #y in o; } }
class Q { a = 1; } class R { b = 2; } class S extends R { c = 3; }
const all = JSON.parse("[0,1,2,0,1,2,3]").map((kind) => (kind === 0 ? new Q() : kind === 1 ? new R() : kind === 2 ? new S() : new P()));
let yes = 0, no = 0;
for (let turn = 0; turn < 500; turn++) for (const o of all) { if (P.x(o)) yes++; else no++; if (P.y(o)) yes++; else no++; }
console.log(yes, no);

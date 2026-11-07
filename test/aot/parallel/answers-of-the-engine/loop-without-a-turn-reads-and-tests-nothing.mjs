// What stands in front of a loop runs where the loop has no turn, and where a turn passes by the operation. So no getter runs, nothing throws for undefined, null or a variable in its dead zone, and nothing is read through what is no object.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Box { x; constructor(x) { this.x = x; } }
let log = "";
const trap = { get x() { log += "x"; return 1; }, get length() { log += "l"; return 2; } };
function nameOf(thrown) { return thrown.name; }
function sum(o, n) { let s = 0; for (let i = 0;i < n; i++) s += o.x; return s; }
function lengths(a, n) { let s = 0; for (let i = 0;i < n; i++) s += a.length; return s; }
function texts(t, n) { let s = 0; for (let i = 0;i < n; i++) s += t.length; return s; }
function deep(o, n) { let s = 0; for (let i = 0;i < n; i++) s += o.box.x; return s; }
function behindBranch(o, n, wanted) { let s = 0; for (let i = 0;i < n; i++) { if (wanted) s += o.x; else s += 1; } return s; }
function early(n) { let s = 0; for (let i = 0;i < n; i++) s += late; return s; }
function tell(f) { try { report(f()); } catch (thrown) { report(nameOf(thrown)); } }
tell(() => sum(new Box(2), 3));
tell(() => sum(trap, 0));
report(log);
tell(() => sum(trap, 2));
report(log);
tell(() => sum(null, 0));
tell(() => sum(undefined, 0));
tell(() => sum(null, 1));
tell(() => sum(7, 2));
tell(() => lengths([1, 2, 3], 2));
tell(() => lengths(trap, 0));
report(log);
tell(() => lengths(trap, 3));
report(log);
tell(() => lengths(null, 0));
tell(() => lengths(null, 1));
tell(() => lengths("four", 2));
tell(() => texts("abc", 2));
tell(() => texts(undefined, 0));
tell(() => texts(undefined, 1));
tell(() => texts([1], 2));
tell(() => deep({ box: new Box(4) }, 2));
tell(() => deep({ box: null }, 0));
tell(() => deep({ box: null }, 1));
tell(() => deep({}, 0));
tell(() => deep({}, 1));
tell(() => deep(null, 0));
tell(() => behindBranch(new Box(3), 2, true));
tell(() => behindBranch(null, 2, false));
tell(() => behindBranch(trap, 2, false));
report(log);
tell(() => behindBranch(null, 2, true));
tell(() => early(0));
tell(() => early(1));
let late = 5;
tell(() => early(2));
report("end");

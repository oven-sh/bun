// A field, a variable and a captured variable that a turn writes: through another name of the object, in a callee, in a getter, in a loop inside or around, under a handler. Only what no turn writes may be read once in front of the loop.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Box { x; constructor(x) { this.x = x; } }
class Pair { left; right; constructor(left, right) { this.left = left; this.right = right; } }
class Counter { box; constructor(box) { this.box = box; } get next() { this.box.x = this.box.x + 1; return 0; } }
let step = 1;
function faster() { step = step + 1; }
function bump(o) { o.x = o.x + 1; }
function throughAlias(a, b, n) { let s = 0; for (let i = 0;i < n; i++) { s += a.x; b.x = b.x + 1; } return s; }
function byCallee(o, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; bump(o); } return s; }
function byGetter(c, o, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; s += c.next; } return s; }
function variable(n) { let s = 0; for (let i = 0;i < n; i++) { s += step; faster(); } return s; }
function variableInBranch(n) { let s = 0; for (let i = 0;i < n; i++) { if (i & 1) step = step + 10; s += step; } return s; }
function captured(n) { let k = 1; const more = () => { k = k + 1; }; let s = 0; for (let i = 0;i < n; i++) { s += k; more(); } return s; }
function outerWrites(o, n) { let s = 0; for (let i = 0;i < n; i++) { for (let j = 0;j < n; j++) s += o.x; o.x = o.x + 1; } return s; }
function innerWrites(o, n) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; for (let j = 0;j < n; j++) o.x = o.x + 1; } return s; }
function otherObject(rows, n) { let s = 0; for (let i = 0;i < rows.length; i++) { const row = rows[i]; for (let j = 0;j < n; j++) s += row.x * j; } return s; }
function replaced(pair, n) { let s = 0; for (let i = 0;i < n; i++) { s += pair.left.x; pair.left = new Box(pair.left.x * 2); } return s; }
function swapped(pair, n) { let s = 0; for (let i = 0;i < n; i++) { s = s * 10 + pair.left.x; const kept = pair.left; pair.left = pair.right; pair.right = kept; } return s; }
function deepStays(pair, n) { let s = 0; for (let i = 0;i < n; i++) s += pair.left.x + pair.right.x * i; return s; }
function deepChanges(pair, n) { let s = 0; for (let i = 0;i < n; i++) { s += pair.left.x; pair.right.x = pair.right.x + 1; } return s; }
function underHandler(o, n) { let s = 0; try { for (let i = 0;i < n; i++) { s += o.x; if (i === 2) throw new Error("stop"); o.x = o.x + 1; } } catch (thrown) { s += o.x * 100; } return s; }
function behindLoop(o, n) { let s = 0; for (let i = 0;i < n; i++) s += o.x; o.x = 50; for (let i = 0;i < n; i++) s += o.x; return s; }
function stays(o, n) { let s = 0; for (let i = 0;i < n; i++) s += o.x * i; return s; }
const one = new Box(1);
report(throughAlias(one, one, 4));
report(throughAlias(new Box(1), new Box(1), 4));
report(byCallee(new Box(1), 4));
const shared = new Box(1);
report(byGetter(new Counter(shared), shared, 4));
report(byGetter(new Counter(new Box(1)), new Box(1), 4));
report(variable(4));
report(variableInBranch(4));
report(captured(4));
report(outerWrites(new Box(1), 3));
report(innerWrites(new Box(1), 3));
report(otherObject([new Box(1), new Box(2), new Box(3)], 3));
report(replaced(new Pair(new Box(1), new Box(5)), 4));
report(swapped(new Pair(new Box(1), new Box(2)), 5));
report(deepStays(new Pair(new Box(1), new Box(2)), 4));
const both = new Box(1);
report(deepChanges(new Pair(both, both), 4));
report(deepChanges(new Pair(new Box(1), new Box(1)), 4));
report(underHandler(new Box(1), 5));
report(underHandler(new Box(1), 2));
report(behindLoop(new Box(1), 3));
report(stays(new Box(3), 4));
report("end");

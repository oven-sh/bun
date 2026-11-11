// outside a loop a guess of one read is one operation: it asks for the shape, looks at the slot, and does the closed read for whatever fails either: a slot that was emptied or made an accessor, another layout, a primitive, a proxy, undefined
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
let calls = 0;
function make(x, y) { return { x, y }; }
function lone(p) { return p.x; }
function other(p) { return p.y; }
function around(p, hook) { const first = p.x; hook(p); return first * 100 + p.x; }
function chain(b) { return b.p.x; }
function guarded(p) { try { return p.x; } catch (error) { return "threw " + (error instanceof TypeError); } }
class Getter { get x() { calls += 1; return 40 + calls; } y = 2; }
class Above { x = 50; y = 60; }
class Below extends Above { z = 70; }
const byName = { lone, other, around, chain, guarded };
report(byName);
function call(name, first, second) { return byName[name](first, second); }
const nothing = (p) => { calls += 100; };
const remove = (p) => { delete p.x; };
const replace = (p) => { Object.defineProperty(p, "x", { get() { calls += 1; return 9; }, configurable: true }); };
const store = (p) => { p.x = 8; };
report(call("lone", make(1, 2)));
report(call("other", make(1, 2)));
report(call("around", make(1, 2), nothing));
report(call("around", make(1, 2), store));
report(call("around", make(1, 2), remove));
report(call("around", make(1, 2), replace));
report(calls);
const removed = make(3, 4);
remove(removed);
report(call("lone", removed));
report(call("other", removed));
Object.setPrototypeOf(removed, { x: 7 });
report(call("lone", removed));
removed.x = 6;
report(call("lone", removed));
const replaced = make(3, 4);
replace(replaced);
report(call("lone", replaced));
report(call("lone", replaced));
report(calls);
report(call("lone", Object.freeze(make(5, 6))));
report(call("lone", { x: 11 }));
report(call("lone", { y: 12 }));
report(call("lone", { y: 13, x: 14 }));
report(call("lone", { x: 15, y: 16, z: 17 }));
report(call("lone", new Getter));
report(call("lone", new Getter));
report(call("lone", new Above));
report(call("lone", new Below));
report(call("lone", Object.create(make(18, 19))));
report(call("lone", Object.create(null)));
report(call("lone", "text"));
report(call("lone", 20));
report(call("lone", true));
report(call("lone", Symbol("s")));
report(call("lone", lone));
report(call("lone", [21]));
report(call("lone", Object.assign([22], { x: 23 })));
report(call("lone", new Proxy({}, { get(target, key) { return key === "x" ? 24 : 25; } })));
report(call("guarded", make(26, 27)));
report(call("guarded", undefined));
report(call("guarded", null));
report(call("chain", { p: make(28, 29) }));
report(call("chain", { p: { x: 30 } }));
report(call("chain", { p: "text" }));
report(call("lone", make(31, 32)));
report(calls);
report("end");

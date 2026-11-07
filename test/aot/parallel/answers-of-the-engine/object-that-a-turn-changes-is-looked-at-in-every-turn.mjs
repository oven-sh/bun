// Code that nobody has seen deletes the property, lays an accessor under it, changes the prototype and freezes the object between two turns. The shape of the object stays what it was, so the test of it may stand in front of the loop. The slot says what has happened, so it is looked at in every turn.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Loose { x; constructor(x) { this.x = x; } }
function tell(f) { try { report(f()); } catch (thrown) { report(thrown.name); } }
function bump(o) { o.x = o.x + 1; }
function byValue(o, n, f) { let s = 0; for (let i = 0;i < n; i++) { s += o.x; f(o); } return s; }
function atTurn(o, n, turn, f) { let s = 0; for (let i = 0;i < n; i++) { if (i === turn) f(o); s += o.x; } return s; }
function stores(o, n, f) { for (let i = 0;i < n; i++) { o.x = i; f(o); } return o.x; }
tell(() => byValue(new Loose(1), 4, bump));
tell(() => byValue(new Loose(1), 4, () => {}));
tell(() => byValue(new Loose(1), 3, (o) => { delete o.x; }));
tell(() => byValue(new Loose(1), 3, (o) => { Object.defineProperty(o, "x", { get() { return 7; }, configurable: true }); }));
tell(() => byValue(new Loose(1), 3, (o) => { Object.setPrototypeOf(o, { y: 1 }); }));
tell(() => byValue(new Loose(1), 3, (o) => { Object.freeze(o); }));
tell(() => atTurn(new Loose(1), 4, 2, (o) => { delete o.x; }));
tell(() => atTurn(new Loose(1), 4, 2, (o) => { delete o.x; Object.setPrototypeOf(o, { x: 9 }); }));
tell(() => atTurn(new Loose(1), 4, 1, (o) => { Object.defineProperty(o, "x", { get() { return 7; }, configurable: true }); }));
tell(() => atTurn(new Loose(1), 4, 3, (o) => { o.x = 40; }));
tell(() => stores(new Loose(1), 4, () => {}));
tell(() => stores(new Loose(1), 4, (o) => { Object.defineProperty(o, "x", { value: 8, writable: false, configurable: true }); }));
tell(() => stores(new Loose(1), 4, (o) => { Object.defineProperty(o, "x", { set(v) {}, get() { return 5; }, configurable: true }); }));
report("end");

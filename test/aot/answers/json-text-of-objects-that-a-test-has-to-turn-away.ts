// answers: without-library
// # one call site, and each deed that makes an object of the layout answer otherwise than its slots say: a property under a computed key, a toJSON of its own, above it, on its class later, a getter, a hidden field, keys in another order, a field gone, an index, a BigInt, a cycle, boxed primitives, Object.create, a proxy. A frozen object is written like any other
// # f2 = text
// # RUN(PLAN): json-plan mechanisms=all
// # PLAN: object [[row]] looks=[NoFieldOutsideSlot, HasLayoutPrototype, OrderWordIsKnown] guards=[]
// # PLAN: code [[row]] may-run-code
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 28 of 28 of 28
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO2: 28 of 28 of 28
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-Folding-EscapeAnalysis $SHELL
// # ALSO3: 28 of 28 of 28
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): unknown;
type Row = { id: number; name: string };
class Item { id = 1; name = "i"; }
function row(id: number): Row { return { id, name: "r" + id }; }
function text(value: Row | Item) { return JSON.stringify(value); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ":" + (e as Error).message); } }
function changed<T extends object>(value: T, change: (value: any) => void): T { change(value); return value; }
const key = String(report("key") === undefined ? "extra" : "other");
tell(() => text(row(1)));
tell(() => text(changed(row(2), o => { o[key] = 1; })));
tell(() => text(changed(row(3), o => { o.toJSON = () => "own"; })));
tell(() => text(changed(row(4), o => { Object.defineProperty(o, "name", { get() { report("getter"); return "g"; }, enumerable: true }); })));
tell(() => text(changed(row(5), o => { Object.defineProperty(o, "name", { value: "hidden", enumerable: false }); })));
tell(() => text(changed(row(6), o => { delete o.id; o.id = 6; })));
tell(() => text(changed(row(7), o => { delete o.name; })));
tell(() => text(changed(row(8), o => { Object.freeze(o); })));
tell(() => text(changed(row(9), o => { Object.setPrototypeOf(o, { toJSON() { return "above"; } }); })));
tell(() => text(changed(row(10), o => { Object.setPrototypeOf(o, null); })));
tell(() => text(changed(row(11), o => { o[0] = "index"; })));
tell(() => text(changed(row(12), o => { o[Symbol.iterator] = 1; })));
tell(() => text(changed(row(13), o => { o.id = 13n; })));
tell(() => text(changed(row(14), o => { o.name = o; })));
tell(() => text(changed(row(15), o => { o.id = "text"; o.name = 15; })));
tell(() => text(changed(row(16), o => { o.name = new String("boxed"); o.id = new Number(16); })));
tell(() => text(changed(row(17), o => { o.name = { toString() { report("toString"); return "t"; } }; })));
tell(() => text(Object.create(row(18)) as Row));
tell(() => text(new Proxy(row(19), { ownKeys(target) { report("ownKeys"); return Reflect.ownKeys(target); } })));
tell(() => text(new Item()));
tell(() => text(changed(new Item(), o => { o.toJSON = () => "own"; })));
(Item.prototype as any).toJSON = function () { return "later:" + this.id; };
tell(() => text(new Item()));
delete (Item.prototype as any).toJSON;
tell(() => text(new Item()));
tell(() => text(row(20)));
report("end");

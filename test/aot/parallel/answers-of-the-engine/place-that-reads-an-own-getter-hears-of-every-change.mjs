// A read by name that finds a getter of the receiver's own remembers where its GetterSetter lies: at its place and in the access table. Each place is warmed on its own. Then its object changes (another getter at the same Structure, a value, a deletion, a setter alone, a throw, a freeze, another prototype, a name more), or another kind of receiver comes by: a child that inherits, two objects of one Structure in turns, a plain object, a compiled one, primitives, null.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const names = [];
for (let i = 0;i < 40; i++) names.push("n" + i);
function make(tag, base) { const o = Object.create(base); for (let k = 0;k < names.length; k++) { const name = names[k]; Object.defineProperty(o, name, { get() { return tag + ":" + name + ":" + (this === o ? "own" : "other"); }, enumerable: true, configurable: true }); } return o; }
function warm(read, o) { let last; for (let i = 0;i < 400; i++) last = read(o); return last; }
function attempt(read, o) { try { return String(read(o)); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "other error"; } }
function log(...parts) { let text = ""; for (let i = 0;i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); report(text); }
function read0(o) { return o.n17; }
const x0 = make("x0", null);
log("another getter at the same Structure: before", warm(read0, x0));
Object.defineProperty(x0, "n17", { get() { return "another getter"; } });
log("another getter at the same Structure: behind", attempt(read0, x0), attempt(read0, x0), attempt((o) => warm(read0, o), x0));
function read1(o) { return o.n17; }
const x1 = make("x1", null);
log("a value in its place: before", warm(read1, x1));
Object.defineProperty(x1, "n17", { value: "a value now", writable: true });
log("a value in its place: behind", attempt(read1, x1), attempt(read1, x1), attempt((o) => warm(read1, o), x1));
function read2(o) { return o.n17; }
const x2 = make("x2", null);
log("deleted: before", warm(read2, x2));
delete x2.n17;
log("deleted: behind", attempt(read2, x2), attempt(read2, x2), attempt((o) => warm(read2, o), x2));
function read3(o) { return o.n17; }
const x3 = make("x3", null);
log("a setter alone: before", warm(read3, x3));
Object.defineProperty(x3, "n17", { get: undefined, set(v) {} });
log("a setter alone: behind", attempt(read3, x3), attempt(read3, x3), attempt((o) => warm(read3, o), x3));
function read4(o) { return o.n17; }
const x4 = make("x4", null);
log("a getter that throws: before", warm(read4, x4));
Object.defineProperty(x4, "n17", { get() { throw new RangeError("thrown"); } });
log("a getter that throws: behind", attempt(read4, x4), attempt(read4, x4), attempt((o) => warm(read4, o), x4));
function read5(o) { return o.n17; }
const x5 = make("x5", null);
log("frozen: before", warm(read5, x5));
Object.freeze(x5);
log("frozen: behind", attempt(read5, x5), attempt(read5, x5), attempt((o) => warm(read5, o), x5));
function read6(o) { return o.n17; }
const x6 = make("x6", null);
log("another prototype: before", warm(read6, x6));
Object.setPrototypeOf(x6, { n17: "above" });
log("another prototype: behind", attempt(read6, x6), attempt(read6, x6), attempt((o) => warm(read6, o), x6));
function read7(o) { return o.n17; }
const x7 = make("x7", null);
log("a name more: before", warm(read7, x7));
x7.more = 1;
log("a name more: behind", attempt(read7, x7), attempt(read7, x7), attempt((o) => warm(read7, o), x7));
function readChild(o) { return o.n17; }
const child = Object.create(make("parent", null));
log("a child that inherits", warm(readChild, child), warm(readChild, child));
function readGrandchild(o) { return o.n39; }
const grandchild = Object.create(Object.create(make("grandparent", null)));
log("a grandchild", warm(readGrandchild, grandchild));
function readTwo(o) { return o.n5; }
const one = make("one", null);
const other = make("other", null);
let both = "";
for (let i = 0;i < 600; i++) both = readTwo(i & 1 ? one : other) + " " + readTwo(i & 1 ? other : one);
log("two of one Structure in turns", both);
function readMany(o) { return o.n17; }
class Compiled { n17; constructor() { this.n17 = "a field"; } }
const plain = {};
for (let k = 0;k < names.length; k++) plain[names[k]] = "plain " + k;
log("warmed", warm(readMany, make("warmed", null)));
log("then others", attempt(readMany, plain), attempt(readMany, new Compiled), attempt(readMany, 5), attempt(readMany, "text"), attempt(readMany, null), attempt(readMany, undefined), attempt(readMany, make("again", null)));
log("then each warmed", warm(readMany, plain), warm(readMany, new Compiled), warm(readMany, make("last", null)));
report("end");

// An ordinary object has accessors of its own, laid by descriptors under computed names, so many that they lie outside its cell. Each is read by name again and again: the access table remembers where the GetterSetter lies. Between the reads the object changes: another getter, a value, a deletion, a setter alone, a child that inherits.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function log(...parts) { let text = ""; for (let i = 0;i < parts.length; i++) text += (i ? " " : "") + String(parts[i]); report(text); }
const names = [];
for (let i = 0;i < 40; i++) names.push("n" + i);
function build(tag, base) { const o = Object.create(base); for (let k = 0;k < names.length; k++) { const name = names[k]; Object.defineProperty(o, name, { get() { return tag + ":" + name + ":" + (this === o ? "own" : "other"); }, enumerable: true, configurable: true }); } return o; }
function read(o) { return o.n3 + " " + o.n17 + " " + o.n39; }
function call(o) { try { return String(o.n21()); } catch (e) { return e instanceof TypeError ? "TypeError" : "other error"; } }
function turns(label, o) { let last = ""; for (let i = 0;i < 300; i++) last = read(o); log(label, last); }
const a = build("a", null);
const b = build("b", null);
turns("first", a);
turns("second, made the same way", b);
turns("first again", a);
Object.defineProperty(a, "n17", { get() { return "another getter"; } });
turns("another getter", a);
turns("the second keeps its own", b);
Object.defineProperty(a, "n3", { value: "a value now", writable: true });
turns("a value in its place", a);
a.n3 = "stored";
turns("stored", a);
delete a.n39;
turns("deleted", a);
Object.defineProperty(a, "n39", { set(v) {}, configurable: true });
turns("a setter alone", a);
Object.defineProperty(b, "n39", { get() { throw new RangeError("thrown by the getter"); }, configurable: true });
for (let i = 0;i < 4; i++) { try { read(b); log("no throw"); } catch (e) { log(e instanceof RangeError, e.message); } }
const child = Object.create(build("c", null));
turns("through a child", child);
Object.defineProperty(child, "n17", { get() { return "the child's own"; }, configurable: true });
turns("the child hides one", child);
const d = build("d", { n21: "unused" });
for (let i = 0;i < 300; i++) call(d);
for (let i = 0;i < 2; i++) log(call(d));
Object.defineProperty(d, "n21", { get() { return function() { return "called on " + (this === d); }; }, configurable: true });
for (let i = 0;i < 300; i++) call(d);
for (let i = 0;i < 2; i++) log(call(d));
Object.freeze(b);
turns("frozen", build("e", null));
const many = [];
for (let i = 0;i < 2000; i++) many.push(build("m" + (i & 3), null));
let seen = new Set;
for (let k = 0;k < many.length; k++) seen.add(read(many[k]));
log(seen.size, seen.has("m2:n3:own m2:n17:own m2:n39:own"));
turns("behind a collection", b === null ? a : build("f", null));
turns("the first, behind a collection", a);
const primitives = [1, "text", true, 10n, Symbol.iterator];
for (let k = 0;k < primitives.length; k++) { const primitive = primitives[k]; let r; for (let i = 0;i < 4; i++) r = primitive.n3; log(typeof primitive, r); }
const dictionary = build("g", null);
for (let i = 0;i < 30; i++) delete dictionary["n" + (i + 4 > 16 && i + 4 < 39 ? 0 : 1)];
for (let i = 0;i < 200; i++) { dictionary["x" + i] = i; if (i & 1) delete dictionary["x" + i]; }
turns("grown and cut", dictionary);
report("end");

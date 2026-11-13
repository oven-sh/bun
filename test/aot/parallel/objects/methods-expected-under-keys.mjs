// Methods that a loop over names stores, or that an object above the receiver has, are found before loops and expected at calls.
// STATISTIC: MethodsExpectedUnderKeys >= 2
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));

function mix(target, names) { for (const name of names) target[name] = function (x) { return this.v + x; }; }
class A { constructor(v) { this.v = v; } }
class B { constructor(v) { this.v = v; this.b = 1; } }
mix(A.prototype, ["foo", "bar"]); mix(B.prototype, ["foo"]);
const a = new A(3), b = new B(4);
function ofMixed(turns) { let n = 0; for (let k = 0; k < turns; k++) n += a.foo(k & 7) + a.bar(1) + b.foo(2); return n; }
function ofEither(turns) { let n = 0; for (let k = 0; k < turns; k++) n += (k & 1 ? a : b).foo(k); return n; }

class Logger { constructor(levels) { this.count = 0; for (const level of levels) this[level] = (text) => this.log(level, text); } log(level, text) { this.count += level.length + text.length; return this.count; } }
const logger = new Logger(["debug", "info", "warn"]);
function ofLogger(turns) { let n = 0; for (let k = 0; k < turns; k++) n += logger.info("a") - logger.warn("bb"); return n; }

const proto = { get() { return this.v; }, set(v) { this.v = v; return this; } };
function make(v) { return Object.setPrototypeOf({ v }, proto); }
const list = [make(1), make(2)];
function ofList(turns) { let n = 0; for (let k = 0; k < turns; k++) n += list[k & 1].get(); return n; }
const created = Object.create(proto); created.v = 5;
function ofCreated(turns) { let n = 0; for (let k = 0; k < turns; k++) { created.set(k); n += created.get(); } return n; }

const base = { hi(x) { return x + 1; } };
const above = { __proto__: base, hi(x) { return super.hi(x) * 2; }, other(x) { return super.hi(x) - 1; } };
function ofSuper(turns) { let n = 0; for (let k = 0; k < turns; k++) n += above.hi(k & 3) + above.other(k); return n; }

const all = () => tell(() => ofMixed(0), () => ofMixed(1), () => ofMixed(50), () => ofEither(20), () => ofLogger(20), () => ofList(1), () => ofList(30), () => ofCreated(30), () => ofSuper(1), () => ofSuper(30));
const put = (target, key, value) => { target[key] = value; };
all(); all();
put(a, "foo", (x) => x * 100); all();
delete a.foo; all();
put(A.prototype, "bar", () => "bar"); all();
put(B.prototype, "foo", 5); all();
put(B.prototype, "foo", function (x) { b.v += 0.5; return x; }); all();
a.v = "text"; all();
put(logger, "info", function (text) { return this === logger ? -1 : -2; }); all();
delete logger.warn; all();
put(proto, "get", function () { return this.v * 2; }); all();
put(list[0], "get", () => 1000); all();
Object.setPrototypeOf(list[1], { get() { return -7; } }); all();
Object.defineProperty(created, "get", { get() { return () => 9; }, configurable: true }); all();
Object.setPrototypeOf(created, null); all();
put(base, "hi", (x) => x * 3); all();
Object.setPrototypeOf(above, { hi(x) { return this === above ? x : -1; } }); all();
Object.setPrototypeOf(above, {}); all();
Object.setPrototypeOf(above, new Proxy({}, { get(t, k) { return () => String(k).length; } })); all();
console.log(lines.join("\n"));

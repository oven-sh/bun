// A getter that returns a captured variable, a name of one, or an element of one by another is answered without a call. What changes between two reads is seen by the next.
// STATISTIC: FunctionsReturningCaptures >= 12
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "function" ? "f" + v.length : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? v.toString() : v && typeof v === "object" ? JSON.stringify(v) : String(v);
const lines = [];
const tell = (...values) => { lines.push(values.map(show).join(" ")); };
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
const define = (target, table) => { for (const name in table) Object.defineProperty(target, name, { get: table[name], enumerable: true, configurable: true }); return target; };
function read(o) { return o.p; }
function readTimes(o, turns) { let last; for (let k = 0; k < turns; k++) last = o.p; return last; }

// Variables of the file, of every kind of value.
let integer = 1, fraction = 0.5, text = "t", flag = false, nothing, empty = null, big = 5n, object = { z: 1 };
const constant = { v: 3 }, list = [1, 2], symbol = Symbol("s"), pattern = /x/g;
function declared(a, b) { return a + b; }
const file = define({}, { integer: () => integer, fraction: () => fraction, text: () => text, flag: () => flag, nothing: () => nothing, empty: () => empty, big: () => big, object: () => object, constant: () => constant, list: () => list, symbol: () => symbol, pattern: () => pattern, declared: () => declared });
const readFile = () => Object.keys(file).map((name) => show(file[name])).join(" ");
tell(readFile(), file.constant === constant, file.list === list, file.declared(1, 2), file.pattern === file.pattern);
integer = 2 ** 31; fraction = -0; text = { toString: () => "u" }; flag = undefined; nothing = NaN; empty = 1; big = "b"; object = null;
tell(readFile());
integer = undefined; fraction = "f"; flag = 2 ** 60; nothing = () => 1;
tell(readFile());

// Captures: of a parameter, of a variable that is written, of one that each call and each turn makes anew.
const ofParameter = (p) => ({ get p() { return p; } });
const ofVariable = (first) => { let p = first; return { o: define({}, { p: () => p }), set: (v) => { p = v; } }; };
const parameters = [1, -0, "s", null, undefined, [1]].map(ofParameter);
tell(...parameters.map(read), ...parameters.map(read));
const variables = [1, 2, 3].map(ofVariable);
tell(...variables.map((v) => read(v.o)));
variables[1].set("two"); variables[2].set(2.5);
tell(...variables.map((v) => read(v.o)), readTimes(variables[2].o, 50));
const turns = [];
for (let k = 0; k < 4; k++) { let p = k * 10; turns.push(define({}, { p: function () { return p; } })); p++; }
tell(...turns.map(read), ...turns.map(read));
const counter = (() => { let i = 0, d = 0.5, b = false, u; return { step() { i = (i + 1) | 0; d += 0.25; b = !b; u = i > 2 ? "x" : undefined; }, get i() { return i; }, get d() { return d; }, get b() { return b; }, get u() { return u; } }; })();
for (let k = 0; k < 4; k++) { tell(counter.i, counter.d, counter.b, counter.u); counter.step(); }

// Not initialized yet: the getter is called, and its frame is on the stack.
function early() { return { get latest() { return late; }, get p() { return late; } }; }
const before = early();
tell(attempt(() => read(before)), attempt(() => { try { return before.latest; } catch (e) { return /latest/.test(e.stack); } }));
let late = 7;
tell(read(before), attempt(() => before.p));

// A name of a capture, an element of one by another, and both behind one another.
const holder = { p: 1, q: "q" };
const named = define({}, { p: () => holder.p, q: () => holder.q, missing: () => holder.missing, length: () => holder.q.length });
tell(named.p, named.q, named.missing, named.length);
holder.p = "changed"; delete holder.q; holder.missing = 0.5;
tell(named.p, named.q, named.missing, attempt(() => named.length));
Object.defineProperty(holder, "p", { get() { return this === holder; }, configurable: true });
tell(named.p, readTimes(named, 10));
const passed = (e) => { const n = Object.create(null); Object.keys(e).forEach(function (k) { Object.defineProperty(n, k, { enumerable: true, configurable: true, get: function () { return e[k]; } }); }); return n; };
const source = { p: 1, add: declared, 5: "five" };
const once = passed(source), twice = passed(once), frozen = Object.freeze(passed(twice));
tell(once.p, twice.p, frozen.p, frozen.add(3, 4), frozen[5]);
source.p = "new"; source.add = (a) => a;
tell(once.p, twice.p, frozen.p, frozen.add(3, 4));
delete source.p;
tell(once.p, frozen.p, "p" in frozen);
Object.defineProperty(source, "p", { get: () => { throw new RangeError("thrown"); }, configurable: true });
tell(attempt(() => read(once)), attempt(() => frozen.p));
let replaced = passed({ p: 1 });
const ofReplaced = define({}, { p: () => replaced.p });
tell(ofReplaced.p); replaced = { p: 2 }; tell(ofReplaced.p); replaced = new Proxy({ p: 3 }, { get: (t, k) => k + t[k] }); tell(ofReplaced.p); replaced = null; tell(attempt(() => ofReplaced.p)); replaced = "text"; tell(ofReplaced.p);

// Getters that are replaced, spied on, deleted, inherited, read with another receiver, through a proxy.
let value = 1;
const o = define({}, { p: () => value });
tell(readTimes(o, 20)); value = 2; tell(read(o));
const original = Object.getOwnPropertyDescriptor(o, "p").get; let calls = 0;
Object.defineProperty(o, "p", { get() { calls++; return [original.call(this)]; }, configurable: true });
tell(read(o), calls, readTimes(o, 3), calls);
Object.defineProperty(o, "p", { get: () => integer, configurable: true }); tell(read(o));
Object.defineProperty(o, "p", { get: function () { return this === o; }, configurable: true }); tell(read(o), Object.create(o).p);
Object.defineProperty(o, "p", { value: "data", configurable: true }); tell(read(o));
delete o.p; tell(read(o)); Object.setPrototypeOf(o, define({}, { p: () => value })); value = 3; tell(read(o), Reflect.get(o, "p", 5), new Proxy(o, {}).p, ({ ...Object.getPrototypeOf(o) }).p);
Object.defineProperty(o, "p", { get: async () => value, configurable: true }); tell(read(o) instanceof Promise);
Object.defineProperty(o, "p", { get: function* () { yield value; }, configurable: true }); tell([...read(o)]);
Object.defineProperty(o, "p", { get: function () { return arguments.length; }, configurable: true }); tell(read(o));
Object.defineProperty(o, "p", { set: () => {}, configurable: true }); tell(read(o));
class Parent { static get p() { return value; } get p() { return value; } }
class Child extends Parent { get p() { return [super.p]; } }
tell(Parent.p, Child.p, new Parent().p, new Child().p);

// Direct eval writes what the getter returns.
function withEval(code) { var p = 1, o = define({}, { p: () => p }); const first = o.p; eval(code); return [first, o.p, read(o)]; }
tell(withEval("p = 'written'"), withEval("var p = 2"), withEval("0"));

// The same function as an ordinary one, and with arguments.
const plain = () => value, lend = (f) => f(() => 1, () => 2);
tell(plain(), lend(plain), [1, 2].map(plain), plain.call(null, 1));
console.log(lines.join("\n"));

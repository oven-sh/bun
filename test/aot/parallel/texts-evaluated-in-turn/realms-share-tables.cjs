// The same text runs in this realm and in contexts of their own, in turn: what belongs to a realm is each realm's.
const vm = require("vm");
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const text = `(function (name, host) {
  const lines = [];
  const show = v => Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v && typeof v === "object" ? JSON.stringify(v) : String(v);
  const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name + ": " + e.message + (e instanceof Error)); } };
  const primitives = ["text", "other" + name, 5, true, 10n, Symbol("s")];
  const reads = [o => o.own, o => o.length, o => o.added, o => o.toString, o => o.describe && o.describe()];
  for (let turn = 0; turn < 6; turn++) {
    for (const p of primitives) for (const read of reads) attempt(() => read(p));
    if (turn === 2) { String.prototype.added = "string of " + name; String.prototype.describe = function () { return name + this; }; Number.prototype.added = "number of " + name; Symbol.prototype.added = "symbol of " + name; }
    if (turn === 4) { delete String.prototype.added; delete String.prototype.describe; delete Number.prototype.added; delete Symbol.prototype.added; }
  }
  class Base { constructor(x) { this.x = x; } get doubled() { return this.x * 2; } set doubled(v) { this.x = v / 2; } method() { return name + this.x; } }
  class Derived extends Base { constructor(x, ...rest) { super(x); this.rest = rest; } method() { return super.method() + this.rest.length; } }
  const objects = [new Base(1), new Derived(2, 3, 4), { x: 5, method() { return "m"; } }, host.object, host.make(7), Object.create(host.object)];
  for (let turn = 0; turn < 4; turn++) for (const o of objects) {
    attempt(() => o.x); attempt(() => o.doubled); attempt(() => { o.doubled = turn; return o.x; }); attempt(() => o.method()); attempt(() => o.missing); attempt(() => "x" in o); attempt(() => "missing" in o);
    attempt(() => o instanceof Base); attempt(() => o instanceof Object); attempt(() => { const keys = []; for (const k in o) keys.push(k); return keys; }); attempt(() => { o["k" + turn] = turn; return o["k" + turn]; });
  }
  for (let turn = 0; turn < 5; turn++) {
    const list = [turn, name, , turn + 0.5], more = [1, 2, 3], numbers = [0.5, NaN, , 2];
    attempt(() => [list instanceof Array, Array.isArray(list), Object.getPrototypeOf(list) === Array.prototype, 0 in list, 2 in list, 4 in list, 1 in more, 1 in numbers, 2 in numbers, -1 in more]);
    attempt(() => ((...r) => [r instanceof Array, r.length, Object.getPrototypeOf(r) === Array.prototype])(1, name, turn));
    attempt(() => { const made = []; for (let k = 0; k < 4; k++) made.push(() => k + turn); return made.map(f => f() + (f instanceof Function)); });
    attempt(() => list.map(x => x + name)); attempt(() => more.reduce((a, b) => a + b, name)); attempt(() => [...more, ...list].length);
    attempt(() => { let t = name; for (let k = 0; k < 5; k++) t += "-" + k; return t + \`\${t.length}:\${turn}\`; });
    attempt(() => (function () { return [arguments.length, arguments[1], Object.getPrototypeOf(arguments) === Object.prototype]; })(1, name));
    attempt(() => { switch (name + turn) { case "this1": return 1; case "first2": return 2; case "second3": return 3; default: return 0; } });
    attempt(() => host.object.x); attempt(() => host.make(turn).method()); attempt(() => null.x); attempt(() => undefinedName);
    if (turn === 3 && name !== "this") Object.defineProperty(Array.prototype, 2, { get() { return "hole of " + name; }, set(v) { lines.push("set " + v); }, configurable: true });
  }
  return lines.join("\\n");
})`;
class Compiled { constructor(x) { this.x = x; } get doubled() { return this.x * 2; } set doubled(v) { this.x = v; } method() { return "compiled" + this.x; } }
const host = { object: { x: 1, method() { return "host"; } }, make: x => new Compiled(x) };
const realms = [["this", vm.runInThisContext(hidden(text))], ["first", vm.runInContext(hidden(text), vm.createContext({}))], ["second", vm.runInNewContext(hidden(text))]];
for (let turn = 0; turn < 2; turn++) for (const [name, run] of realms) console.log(name + "\n" + run(name, host));

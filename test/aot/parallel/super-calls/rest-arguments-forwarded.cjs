// Rest parameters that only one call reads, with every count of arguments, kinds of callee and shapes of the call.
// STATISTIC: RestArraysForwarded >= 12
"use strict";
const out = [];
const show = (...xs) => xs.map(x => typeof x === "function" ? "f" : typeof x === "symbol" ? "s" : x === undefined ? "u" : Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{" + Object.keys(x) + "}" : String(x)).join();
function plain() { return "p" + arguments.length + ":" + show(...arguments); }
function three(a, b, c) { return "t:" + show(a, b, c); }
function six(a, b, c, d, e, f) { return "x:" + show(a, b, c, d, e, f); }
function keepsThis(a) { return (this === undefined ? "u" : this.tag || typeof this) + show(a); }
function defaults(a = 1, b = a + 1, ...c) { return show(a, b, c.length); }
const arrow = (...a) => "a" + a.length + show(...a);
const bound = three.bind({ tag: "b" }, 7), bound5 = six.bind(null, 1, 2, 3, 4, 5);
const proxied = new Proxy(plain, { apply(t, self, list) { return "proxy" + list.length + t(...list); } });
class Base { method(...xs) { return "base" + this.tag + xs.length + show(...xs); } get getter() { return function (...xs) { return "getter" + this.tag + show(...xs); }; } static make(...xs) { return "make" + show(...xs); } }
const mixin = Parent => class extends Parent {
  constructor(tag) { super(); this.tag = tag; }
  method(...args) { const result = super.method(...args); return result + "!"; }
  viaGetter(...args) { const result = super.getter(...args); return result + "?"; }
  missing(...args) { try { const r = super.nothing(...args); return r; } catch (e) { return e.constructor.name; } }
  static make(...args) { const r = super.make(...args); return r + "."; }
};
const A = mixin(Base), B = mixin(A);
function wrap(f) { return function (...args) { const r = f(...args); return "[" + r + "]"; }; }
function wrapOne(f) { return function (first, ...args) { const r = f(...args); return show(first) + "<" + r + ">"; }; }
function wrapFive(f) { return function (a, b, c, d, e, ...args) { const r = f(...args); return show(a, b, c, d, e) + "<" + r + ">"; }; }
function wrapThis(f) { return function (...args) { const r = f.call(...args); return "(" + r + ")"; }; }
function wrapMethod(o, name) { return function (...args) { const r = o[name](...args); return "m" + r; }; }
function wrapTail(f) { return function (...args) { return f(...args); }; }
function wrapTwice(f) { return function (...args) { const a = f(...args), b = f(...args); return a + b; }; }
function wrapKept(f) { return function (...args) { const r = f(...args); args.push(r); return args.length; }; }
function wrapTry(f) { return function (...args) { try { const r = f(...args); return "ok" + r; } catch (e) { return "caught " + e.message; } finally { out.push("finally"); } }; }
function wrapReassign(f) { return function (a, ...args) { a = 9; const r = f(...args); return r + a; }; }
function* wrapGenerator(f, ...args) { yield 1; const r = f(...args); yield r; }
async function wrapAsync(f, ...args) { await null; const r = f(...args); return r; }
function thrower(...xs) { throw new Error("thrown " + xs.length + show(...xs)); }
function recursive(n, ...rest) { if (n > 60) return show(...rest); const r = recursive(n + 1, n, ...rest.slice(0, n % 9)); return r; }
function deep(...args) { if (args[0] <= 0) return args.length; args[0]--; const r = deep(...args); return r; }
const callees = [plain, three, six, keepsThis, defaults, arrow, bound, bound5, proxied, Math.max, String, Array, Array.of, parseInt, Object, wrap(plain), wrapOne(three), thrower, isNaN, "".concat, Reflect.apply.bind(null, plain, null)];
const lists = [[], [1], [1, 2], [undefined], [null, -0, "a"], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1.5, "x", {}, [], () => 1, Symbol.iterator && 6], Array.from({ length: 17 }, (_, i) => i), Array.from({ length: 300 }, (_, i) => i * 1.5)];
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
const digest = s => { s = String(s); return s.length > 60 ? s.slice(0, 40) + "#" + s.length : s; };
for (let round = 0; round < 3; round++) {
  for (const f of callees) for (const w of [wrap, wrapOne, wrapFive, wrapTail, wrapTwice, wrapKept, wrapTry, wrapReassign, wrapThis]) {
    const g = w(f);
    out.push(lists.map(l => digest(attempt(() => g(...l)))).join(" | "));
  }
  for (const l of lists) {
    const a = new A("a"), b = new B("b");
    out.push([a.method(...l), b.method(...l), a.viaGetter(...l), b.missing(...l), B.make(...l), wrapMethod(a, "method")(...l), wrapMethod(Math, "max")(...l.map(Number.bind(null)).filter(x => x === x))].map(digest).join(" | "));
    out.push([...wrapGenerator(plain, ...l)].map(digest).join());
  }
  out.push(digest(recursive(1)), deep(50, 1, 2), deep(50, 1, 2, 3, 4, 5, 6));
}
for (const bad of [undefined, null, 5, "text", {}, Symbol("q"), class {}]) for (const w of [wrap, wrapTry, wrapOne]) out.push(attempt(() => w(bad)(1, 2, 3)), attempt(() => w(bad)(1, 2, 3, 4, 5, 6)));
const huge = Array.from({ length: 30000 }, (_, i) => i);
out.push(digest(wrap(function () { return arguments.length + arguments[29999]; })(...huge)), digest(wrap(Math.max)(...huge)));
Promise.all(lists.slice(0, 2).map(l => wrapAsync.apply(null, Object.assign(l, {}).length ? [plain, 1] : [plain]))).then(r => { console.log(out.join("\n")); console.log(r.length); });

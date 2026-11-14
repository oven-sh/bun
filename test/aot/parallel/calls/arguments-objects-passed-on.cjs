// Arguments objects handed to apply, Reflect.apply and spread: what they hold, what was changed on them, and what runs.
const log = [];
function show(v) { return typeof v === "function" ? "fn " + v.name : typeof v === "object" && v ? "{" + Object.keys(v) + "}" : typeof v + " " + String(v); }
function take(x, y, z) { return [show(x), show(y), show(z), arguments.length, this && this.tag].join(); }
function forward() { return take.apply(this, arguments); }
function reflect() { return Reflect.apply(take, { tag: "r" }, arguments); }
function spread() { return take(...arguments); }
function named(a, b) { a = { changed: 1 }; arguments[1] = () => b; return take.apply(this, arguments); }
function counted() { arguments.length = { valueOf() { log.push("length"); return 2; } }; return take.apply(null, arguments); }
function getter() { Object.defineProperty(arguments, "length", { get() { log.push("length getter"); return 1; } }); return take.apply(null, arguments); }
function element() { Object.defineProperty(arguments, 0, { get() { log.push("element"); return { got: 1 }; } }); return take.apply(null, arguments); }
function callee() { const own = arguments.callee; own.calls = (own.calls | 0) + 1; arguments.callee = { replaced: 1 }; return own === callee && own.calls + take.apply(null, arguments) + show(arguments.callee); }
function recursive(n) { return n > 0 ? n + arguments.callee.apply(this, [n - 1]) : 0; }
function iterated() { arguments[Symbol.iterator] = function* () { log.push("iterator"); yield 8; }; return take(...arguments) + take.apply(null, arguments); }
function above() { Object.setPrototypeOf(arguments, { 2: "above", toString() { return "t"; } }); arguments.length = 3; return take.apply(null, arguments) + arguments; }
function kept() { kept.last = arguments; return take.apply(this, arguments); }
function emptied() { delete arguments[0]; arguments[1] = arguments; return take.apply(null, arguments); }
const object = { own: 1, valueOf() { log.push("valueOf"); return 3; }, toString() { log.push("toString"); return "s"; } };
function callback() { log.push("called"); }
for (const f of [forward, reflect, spread, named, counted, getter, element, callee, iterated, above, kept, emptied]) {
  const lines = new Set();
  for (let i = 0; i < 100; i++) lines.add(f(1, 2) + " | " + f.call({ tag: "t" }, object, callback) + " | " + f());
  console.log(f.name, [...lines].slice(0, 2).join(" ; "), lines.size);
}
console.log(recursive(5), kept.last.length, log.length, [...new Set(log)].join());

// Constructors of the old style that initialize by apply.
function P() { this.init.apply(this, arguments); }
P.prototype.init = function (x, y) { this.x = x; if (y) this.y = y; };
P.prototype.sum = function () { return this.x + (this.y | 0); };
function Q() { if (!(this instanceof Q)) return "no new"; this.init.apply(this, arguments); return arguments.length === 3 ? { other: true } : undefined; }
Q.prototype = { y: 100, init: P.prototype.init, sum: P.prototype.sum };
function run(n) { let total = 0; for (let i = 0; i < n; i++) total += new P(i, 1).sum() + new P(i).sum() + new Q(i, 2).sum(); return total; }
console.log(run(300), Q(1), new Q(1, 2, 3).other, Object.keys(new P(1)).join(), Object.keys(new Q(1)).join(), new Q(1).y, new P(1).constructor === P, new Q(1).constructor === Object);
const init = P.prototype.init;
P.prototype.init = function () { log.push("new init"); init.apply(this, Array.prototype.slice.call(arguments).reverse()); };
console.log(new P(1, 2).x, run(3));
P.prototype.init = init;
console.log(new P(callback).x === callback, show(new P(object, object).y), P.length, P.name);
Object.freeze(P.prototype);
console.log(run(3), Reflect.construct(P, [4, 5], Q).sum(), Reflect.construct(P, [4, 5], Q) instanceof Q);

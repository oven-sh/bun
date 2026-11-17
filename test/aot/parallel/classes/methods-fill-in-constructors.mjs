// Class constructors call methods of the new object before and between their stores: the keys of the methods come first.
// STATISTIC: OrdersAfterMethods >= 1
const show = o => Object.keys(o).join() + " " + JSON.stringify(o);
class Fiber {
  constructor(context, flag = true) {
    this.setContext(context);
    this.id = ++Fiber.ids; this.count = 0; this.flag = flag; this.stack = []; this.observers = undefined; this.exit = undefined; this.running = false;
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && previous === context) return;
    if (this.cache?.kind !== context.kind) this.dispatcher = undefined;
    this.cache = context;
  }
  static ids = 0;
}
class Reset { constructor(n) { this.reset(); this.n = n; this.after = [n]; } reset() { this.a = 1; this.b = "b"; this.c = null; } }
class Between { constructor(n) { this.first = n; this.fill(n); this.last = n; } fill(n) { this.x = n; this.more(n + 1); } more(m) { this.y = m; this.z = m; } }
class Conditional { constructor(n) { this.fill(n); this.end = n; this.tail = 1; } fill(n) { if (n & 1) this.odd = n; else this.even = n; if (n > 3) return; this.small = true; } }
class Overridden extends Reset { reset() { this.own = 2; super.reset(); } }
class Throws { constructor(n) { try { this.fill(n); } catch (error) { this.message = error.message; } this.n = n; this.m = n; } fill(n) { this.before = n; if (n === 2) throw new Error("two"); this.behind = n; } }
class Deletes { constructor(n) { this.fill(); if (n & 1) delete this.a; this.n = n; this.m = n; } fill() { this.a = 1; this.b = 2; } }
class Leaks { constructor(n) { this.fill(n); this.n = n; this.o = n; } fill(n) { this.a = n; held.push(this); if (n === 3) { this.n = "early"; this.extra = 1; } } }
class Frozen { constructor(n) { this.fill(n); this.n = n; } fill(n) { this.a = n; if (n === 4) Object.freeze(this); } }
class Accessor { constructor(n) { this.fill(n); this.n = n; this.p = n; } fill(n) { this.a = n; Object.defineProperty(this, "n", n === 2 ? { set(v) { held.push("set " + v); }, configurable: true, enumerable: true } : { value: 0, writable: true, configurable: true, enumerable: true }); } }
class Initialized { z = 0; y; constructor(n) { this.fill(n); this.n = n; } fill(n) { this.x = n; this.y = n; } }
function Plain(n) { this.fill(n); this.n = n; this.m = n; }
Plain.prototype.fill = function (n) { this.a = n; this.b = n; };
const held = [];
const classes = [Fiber, Reset, Between, Conditional, Overridden, Throws, Deletes, Leaks, Frozen, Accessor, Initialized, Plain];
function make(Class, n) { try { return show(new Class(Class === Fiber ? { kind: n } : n)); } catch (error) { return error.constructor.name; } }
for (let turn = 0; turn < 3; turn++) {
  for (const Class of classes) console.log(Class.name, [0, 1, 2, 3, 4].map(n => make(Class, n)).join(" | "));
  console.log(held.length, held.map(x => typeof x === "string" ? x : show(x)).join(" "));
  held.length = 0;
  if (turn === 0) Reset.prototype.reset = function () { this.c = 3; this.a = 1; };
  if (turn === 1) { Between.prototype.more = function () { }; Plain.prototype.fill = function (n) { this.m = n; this.a = n; }; Object.defineProperty(Conditional.prototype, "end", { set(v) { held.push("end " + v); }, configurable: true }); }
}

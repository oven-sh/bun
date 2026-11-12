// Fields that hold int32s alone, stored by code that knows nothing of the object: every int32, what lies outside, fractions, other kinds, with the stub's words hot in front.
"use strict";
class Counter { constructor() { this.n = 0; this.tiny = 1; this.other = "x"; } get sum() { return this.n + this.tiny; } bump() { this.n = (this.n + 1) | 0; this.tiny = this.tiny === 1 ? 2 : 1; return this.n; } }
class Wide extends Counter { constructor() { super(); this.more = 7; } bump() { this.more = (this.more * 3) | 0; return super.bump() + this.more; } }
class Plain { constructor() { this.tiny = 0; this.n = 5; } get sum() { return this.n * 2 + this.tiny; } bump() { this.n = (this.n - 1) | 0; return this.n; } }
function Old() { this.n = 1; this.tiny = 2; }
Old.prototype.bump = function () { this.n = (this.n ^ 3) | 0; return this.n; };
Object.defineProperty(Old.prototype, "sum", { get: function () { return this.n - this.tiny; } });
const unknown = JSON.parse('{"n":1,"tiny":2,"sum":3}');
function put(o, v) { o.n = v; }
function putTiny(o, v) { o.tiny = v; }
function putBy(o, k, v) { o[k] = v; }
function read(o) { return String(o.n) + "," + String(o.tiny) + "," + String(o.sum); }
const values = [1, 2, 3, 70000, -1, 2147483647, -2147483648, 0, 2147483648, -2147483649, 1.5, -0, NaN, Infinity, 4294967295, 5e15, "text", "7", true, false, undefined, null, 9n, Symbol.iterator.description, [1], { valueOf() { return 4; } }];
const makes = [() => new Counter(), () => new Wide(), () => new Plain(), () => new Old(), () => ({ ...unknown })];
let out = "";
function turn(list, v) {
  let s = 0;
  for (let i = 0; i < 40; i++) {
    const o = list[i % list.length];
    put(o, i & 7); putTiny(o, 1 + (i & 1)); putBy(o, "n", (o.n + 1) | 0);
    s = (s + o.n + o.tiny) | 0;
    if (typeof o.bump === "function") s = (s + o.bump()) | 0;
  }
  for (const o of list) put(o, v);
  out += list.map(read).join(";") + " " + s;
  for (const o of list) putTiny(o, v);
  out += " " + list.map(read).join(";");
  for (const o of list) putBy(o, "n", v);
  for (const o of list) putBy(o, "tiny", v);
  out += " " + list.map(read).join(";") + "\n";
}
for (const v of values) {
  const list = makes.map(m => m());
  try { turn(list, v); } catch (e) { out += e.constructor.name + "\n"; }
}
const kept = makes.map(m => m());
for (let round = 0; round < 3; round++) for (const v of values) { try { turn(kept, v); } catch (e) { out += e.constructor.name + "\n"; } }
console.log(out);
for (const o of kept) console.log(JSON.stringify(Object.keys(o)), typeof o.n, typeof o.tiny);

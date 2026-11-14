// for (const x of this.items()) where the class escapes: the method and what its generators inherit are replaced before, between and during the loops.
const ticks = [];
const tick = value => { if (ticks.length < 200) ticks.push(value); };
class Holder {
  constructor(count) { this.count = count; this.map = new Map(Array.from({ length: count }, (_, i) => ["k" + i, { v: i, odd: i % 2 === 1 }])); }
  *items() { for (let [name, entry] of this.map) yield { name, entry, odd: entry.odd }; }
  *guarded() { try { for (const entry of this.map.values()) yield entry; } finally { tick("closed " + this.count); } }
  *numbers(limit = this.count) { for (let i = 0; i < limit; i++) { if (i === 7) throw new Error("seven"); yield i; } return "end"; }
  countOdd() { let odd = 0; for (const item of this.items()) if (item.odd) odd++; return odd; }
  names() { let text = ""; for (const { name, entry } of this.items()) text += name + entry.v; return text; }
  firstOver(limit) { for (const entry of this.guarded()) { if (entry.v > limit) return entry.v; } return -1; }
  untilOdd() { let sum = 0; for (const entry of this.guarded()) { if (entry.odd) break; sum += entry.v + 1; } return sum; }
  sum() { let sum = 0; for (const n of this.numbers()) sum += n; return sum; }
  caught() { let sum = 0; try { for (const n of this.numbers(9)) sum += n; } catch (error) { sum += error.message; } return sum; }
  *odd() { for (const item of this.items()) if (item.odd) yield item.entry.v; }
  *all() { for (const entry of this.guarded()) { const sent = yield entry.v; if (sent === "stop") return "stopped"; } return "all"; }
  *nested() { for (const entry of this.guarded()) for (const n of this.numbers(entry.v)) yield n * 10 + entry.v; }
  trace() { for (const item of this.traced()) return item; }
  *traced() { yield new Error("t").stack.split("\n").slice(1, 4).map(line => line.trim().replace(/^at /, "").split(/[ @(]/)[0]).join("<"); }
}
class Heir extends Holder { *items() { yield { name: "heir", entry: { v: 100, odd: true }, odd: true }; yield* super.items(); } }
globalThis.Holder = Holder;
globalThis.known = [new Holder(3), new Heir(2)];

function look(holder) {
  const out = [];
  const attempt = run => { try { out.push(String(run())); } catch (error) { out.push("threw " + String(error?.message ?? error).split(" (")[0]); } };
  for (const name of ["countOdd", "names", "untilOdd", "sum", "caught", "trace"]) attempt(() => holder[name]());
  attempt(() => holder.firstOver(1));
  attempt(() => [...holder.odd()].join());
  attempt(() => [...holder.nested()].join());
  attempt(() => { const all = holder.all(); return [all.next().value, all.next("go").value, JSON.stringify(all.next("stop")), all.next().done].join(); });
  attempt(() => { const all = holder.all(); return [all.next().value, JSON.stringify(all.return("early")), all.next().done].join(); });
  attempt(() => { const all = holder.all(); all.next(); return all.throw(new Error("into")); });
  return out.join(" | ");
}
const lines = [];
for (let turn = 0; turn < 60; turn++) { const line = look(new Holder(turn % 10)) + " # " + look(new Heir(turn % 4)); if (turn % 10 === 0) lines.push(line); }

const { items, guarded, numbers } = Holder.prototype;
const changes = [
  () => { Holder.prototype.items = function* () { yield { name: "x", entry: { v: 1, odd: true }, odd: true }; }; },
  () => { Holder.prototype.items = () => [{ name: "list", entry: { v: 2, odd: true }, odd: true }]; },
  () => { Holder.prototype.items = 5; },
  () => { Holder.prototype.items = items; items.prototype.next = function () { tick("next"); return { done: true }; }; },
  () => { delete items.prototype.next; items.prototype[Symbol.iterator] = function () { tick("iterator"); return [{ name: "i", entry: { v: 3, odd: true }, odd: true }][Symbol.iterator](); }; },
  () => { delete items.prototype[Symbol.iterator]; guarded.prototype.return = function (value) { tick("return"); return { done: true, value }; }; },
  () => { delete guarded.prototype.return; Object.setPrototypeOf(numbers.prototype, { next() { tick("other next"); return { done: true }; }, [Symbol.iterator]() { return this; } }); },
  () => { numbers.prototype = null; },
  () => { numbers.prototype = { __proto__: Object.getPrototypeOf(function* () {}.prototype), extra: 1 }; },
  () => { items.prototype.extra = 1; },
];
for (const change of changes) { change(); for (let turn = 0; turn < 4; turn++) lines.push(look(new Holder(turn * 3)) + " # " + look(new Heir(turn))); }
Holder.prototype.items = items;

const own = new Holder(4);
own.items = function* () { yield { name: "own", entry: { v: 9, odd: true }, odd: true }; };
lines.push(look(own), look({ __proto__: Holder.prototype, count: 2, map: new Map([["a", { v: 1, odd: true }]]) }));
lines.push(Holder.prototype.countOdd.call({ items: () => [{ odd: true }, { odd: false }] }), Holder.prototype.names.call({ *items() { yield { name: "c", entry: { v: 1 } }; } }));
const during = new Holder(5);
for (const value of during.all()) { if (value === 1) Holder.prototype.guarded = function* () { yield { v: 50 }; }; lines.push(value); }
lines.push(look(new Holder(2)), ticks.join());
console.log(lines.join("\n"));

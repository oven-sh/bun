// Loops over a pool whose iterators count themselves open and closed, and over objects whose [Symbol.iterator] hands back what another method of theirs made of a list, a Map or a Set and gave a return or a next, kept, or stepped.
"use strict";
class Pool {
  constructor() { this.seats = ["a", "b", "c"]; this.open = 0; this.closed = 0; }
  lease() { const it = this.seats.values(); this.open++; it.return = value => { this.open--; this.closed++; return { done: true, value }; }; return it; }
  [Symbol.iterator]() { return this.lease(); }
}
const lines = [], tell = (name, pool, what) => lines.push(`${name}: ${what} open ${pool.open} closed ${pool.closed}`);
function firstOf(pool, wanted) { for (const seat of pool) if (seat === wanted) return seat; return "none"; }
function taken(pool, most) { const out = []; for (const seat of pool) { out.push(seat); if (out.length === most) break; } return out.join(""); }
function failing(pool) { try { for (const seat of pool) if (seat === "b") throw new Error(seat); } catch (e) { return e.message; } return "none"; }
function rounds(pool, n) { let s = ""; next: for (let i = 0; i < n; i++) for (const seat of pool) { s += seat; if (seat === "b") continue next; } return s; }
function inner(pool) { let s = ""; for (const x of pool) for (const y of pool) { s += x + y; break; } return s; }
for (let t = 0; t < 3; t++) {
  const pool = new Pool();
  tell("first", pool, firstOf(pool, "b")); tell("none", pool, firstOf(pool, "z")); tell("taken", pool, taken(pool, 2)); tell("all", pool, taken(pool, 9)); tell("failing", pool, failing(pool)); tell("rounds", pool, rounds(pool, 3)); tell("inner", pool, inner(pool));
  const [x] = pool; tell("pattern", pool, x); tell("spread", pool, [...pool].join(""));
  const own = new Pool(); for (const seat of own) { if (seat === "a") break; } tell("own", own, "");
}
let said = "", last = null;
const kept = () => last ? JSON.stringify(last.next()) : "-";
class ListNext { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items.values(); let k = 0; it.next = () => ({ done: k > 1, value: 70 + k++ }); return it; } [Symbol.iterator]() { return this.make(); } }
class ListKept { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items.values(); last = it; return it; } [Symbol.iterator]() { return this.make(); } }
class ListStepped { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items.values(); it.next(); return it; } [Symbol.iterator]() { return this.make(); } }
class OwnReturn { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items[Symbol.iterator](); it.return = () => { said += "r"; return {}; }; return it; } [Symbol.iterator]() { return this.make(); } }
class OwnKept { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items[Symbol.iterator](); last = it; return it; } [Symbol.iterator]() { return this.make(); } }
class OwnStepped { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items[Symbol.iterator](); it.next(); return it; } [Symbol.iterator]() { return this.make(); } }
class MapReturn { constructor() { this.table = new Map([["a", 1], ["b", 2], ["c", 3]]); } make() { const it = this.table.values(); it.return = () => { said += "m"; return {}; }; return it; } [Symbol.iterator]() { return this.make(); } }
class MapNext { constructor() { this.table = new Map([["a", 1], ["b", 2]]); } make() { const it = this.table.values(); let k = 0; it.next = () => ({ done: k > 1, value: 70 + k++ }); return it; } [Symbol.iterator]() { return this.make(); } }
class MapStepped { constructor() { this.table = new Map([["a", 1], ["b", 2], ["c", 3]]); } make() { const it = this.table.entries(); it.next(); return it; } [Symbol.iterator]() { return this.make(); } }
class SetReturn { constructor() { this.bag = new Set([4, 5, 6]); } make() { const it = this.bag.values(); it.return = () => { said += "s"; return {}; }; return it; } [Symbol.iterator]() { return this.make(); } }
class SetNext { constructor() { this.bag = new Set([4, 5, 6]); } make() { const it = this.bag.values(); let k = 0; it.next = () => ({ done: k > 1, value: 70 + k++ }); return it; } [Symbol.iterator]() { return this.make(); } }
class SetKept { constructor() { this.bag = new Set([4, 5, 6]); } make() { const it = this.bag.values(); last = it; return it; } [Symbol.iterator]() { return this.make(); } }
for (let t = 0; t < 3; t++) {
  let s = ""; for (const x of new ListNext()) s += x + ";"; lines.push("list, next " + s);
  s = ""; last = null; for (const x of new ListKept()) { s += x; if (x === 2) break; } lines.push("list, kept " + s + kept());
  s = ""; for (const x of new ListStepped()) s += x; lines.push("list, stepped " + s);
  s = said = ""; for (const x of new OwnReturn()) { s += x; if (x === 2) break; } lines.push("own, return " + s + said);
  s = ""; last = null; for (const x of new OwnKept()) { s += x; if (x === 2) break; } lines.push("own, kept " + s + kept());
  s = ""; for (const x of new OwnStepped()) s += x; lines.push("own, stepped " + s);
  s = said = ""; for (const x of new MapReturn()) { s += x; if (x === 2) break; } lines.push("map, return " + s + said);
  s = ""; for (const x of new MapNext()) s += x + ";"; lines.push("map, next " + s);
  s = ""; for (const [k, v] of new MapStepped()) s += k + v; lines.push("map, stepped " + s);
  s = said = ""; for (const x of new SetReturn()) { s += x; if (x === 5) break; } lines.push("set, return " + s + said);
  s = ""; for (const x of new SetNext()) s += x + ";"; lines.push("set, next " + s);
  s = ""; last = null; for (const x of new SetKept()) { s += x; if (x === 5) break; } lines.push("set, kept " + s + kept());
}
console.log(lines.join("\n"));

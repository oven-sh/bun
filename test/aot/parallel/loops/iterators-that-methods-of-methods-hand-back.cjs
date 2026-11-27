// Loops over objects whose [Symbol.iterator] hands back what another method of theirs made and then changed, kept, stepped, or left as it was.
// STATISTIC: IteratorAllocationsElidedInInlinees >= 2
"use strict";
let said = "", last = null;
const lines = [], tell = name => { lines.push(name + " " + said + " " + (last ? JSON.stringify(last.next()) : "-")); said = ""; last = null; };
class Returning { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items.values(); it.return = () => { said += "r"; return {}; }; return it; } [Symbol.iterator]() { return this.make(); } }
class Counting { constructor() { this.items = [1, 2, 3]; } make() { const it = this.items[Symbol.iterator](); let k = 0; it.next = () => { said += "n"; return { done: k > 1, value: 70 + k++ }; }; return it; } [Symbol.iterator]() { return this.make(); } }
class Keeping { constructor() { this.table = new Map([["a", 1], ["b", 2], ["c", 3]]); } make() { return last = this.table.values(); } [Symbol.iterator]() { return this.make(); } }
class Stepping { constructor() { this.bag = new Set([4, 5, 6]); } make() { const it = this.bag.values(); it.next(); return it; } [Symbol.iterator]() { return this.make(); } }
class TwoAway { constructor() { this.table = new Map([["a", 1], ["b", 2], ["c", 3]]); } made() { const it = this.table.keys(); it.return = () => { said += "R"; return {}; }; return it; } make() { return this.made(); } [Symbol.iterator]() { return this.make(); } }
class Lower { constructor() { this.items = [7, 8, 9]; } [Symbol.iterator]() { const it = this.items.values(); it.return = () => { said += "l"; return {}; }; return it; } }
class Upper extends Lower { [Symbol.iterator]() { return super[Symbol.iterator](); } }
class Plain { constructor() { this.items = [1, 2, 3]; } make() { return this.items.values(); } [Symbol.iterator]() { return this.make(); } }
class Entries { constructor() { this.table = new Map([["a", 1], ["b", 2]]); } entries() { return this.table.entries(); } [Symbol.iterator]() { return this.entries(); } }
for (let t = 0; t < 3; t++) {
  let s = ""; for (const x of new Returning()) { s += x; if (x === 2) break; } lines.push(s); tell("return");
  s = ""; for (const x of new Returning()) s += x; lines.push(s); tell("whole");
  s = ""; try { for (const x of new Returning()) { s += x; if (x === 2) throw new Error("out"); } } catch (e) { s += e.message; } lines.push(s); tell("thrown");
  s = ""; outer: for (const y of [1, 2]) for (const x of new Returning()) { s += x; if (x === 2) continue outer; } lines.push(s); tell("continued");
  s = ""; for (const x of new Counting()) s += x + ";"; lines.push(s); tell("next");
  s = ""; for (const x of new Keeping()) { s += x; if (x === 2) break; } lines.push(s); tell("kept");
  s = ""; for (const x of new Stepping()) s += x; lines.push(s); tell("stepped");
  s = ""; for (const x of new TwoAway()) { s += x; if (x === "b") break; } lines.push(s); tell("two");
  s = ""; for (const x of new Upper()) { s += x; if (x === 8) break; } lines.push(s); tell("super");
  s = ""; for (const x of new Plain()) { s += x; if (x === 2) break; } for (const [k, v] of new Entries()) s += k + v; lines.push(s); tell("untouched");
}
console.log(lines.join("\n"));

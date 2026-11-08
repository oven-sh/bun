// forInGiven make returned arrow outer on=methods n=3 reaches
const out = [];
let hits = 0;
function show(x) { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e) { return e instanceof Error ? e.name : "!" + show(e); }
function step() { hits++; if (hits === 1) throw undefined; return hits; }
function pair(a, b) { return show(a) + "/" + show(b); }
const made = { "0"(a) { out.push(a); return step(); }, "1"(a) { out.push(a); return 1; }, "2"(a) { out.push(a); throw undefined; } };
const run = (cells, store) => {
  let turns = 0;
  let slot = undefined;
  try { for (slot in cells) { out.push(pair(new store[slot](slot), slot));  if (++turns === 3) return slot; } } catch (e) { return slot; } finally { out.push(show(slot)); } return "end";
};
try { out.push(run([7, 8, 9], made)); } catch (e) { out.push("escaped", said(e)); }
console.log(out.map(show).join(" "), hits);

// forInGiven remove argumentsOuter method param on=view n=3 reaches
const out = [];
let hits = 0;
function show(x) { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e) { return e instanceof Error ? e.name : "!" + show(e); }
function step() { hits++; if (hits === 0) throw 0; return hits; }
const made = new Int32Array([1, 5, 2, 3]);
const mild = new Int32Array([1, 5, 2, 3]);
class Host { run(slot, items, table) {
  let got;
  try { for (slot in items) { const same = slot; got = delete table[slot]; out.push(same === slot); step(); } } catch (e) { out.push(said(e), arguments[0], show(slot)); } out.push(arguments[0]);
} }
const host = new Host();
try { out.push(host.run(undefined, [7, 8, 9], mild)); } catch (e) { out.push("escaped", said(e)); }
try { out.push(host.run(undefined, [7, 8, 9], made)); } catch (e) { out.push("escaped", said(e)); }
out.push(Object.keys(made).join(), Object.values(made));
out.push(Object.keys(mild).join(), Object.values(mild));
console.log(out.map(show).join(" "), hits);

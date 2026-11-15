// A WeakSet that only its function asks and fills, and those that others see.
function visit(queue) {
  var visited = new WeakSet(), out = 0;
  for (var i = 0; i < queue.length; i++) {
    var node = queue[i];
    if (visited.has(node)) continue;
    if (node) visited.add(node);
    out++;
  }
  return out;
}
function block(list) {
  let n = 0;
  for (const part of list) { const seen = new WeakSet(); for (const it of part) { if (!seen.has(it)) n++; seen.add(it); } }
  return n;
}
function early(list) { try { if (kept.has(list)) return 1; } catch (error) { return error.constructor.name; } var kept = new WeakSet(); kept.add(list); return 2; }
function maybe(x, o) { if (x) { var kept = new WeakSet(); kept.add(o); } try { return kept.has(o); } catch (error) { return error.constructor.name; } }
function dead(o) { try { seen.add(o); } catch (error) { return error.constructor.name; } const seen = new WeakSet(); return seen.has(o); }
function escapes(o) { const seen = new WeakSet(); seen.add(o); return seen; }
function chains(o) { const seen = new WeakSet(); return seen.add(o).has(o); }
function filled(o) { const seen = new WeakSet([o]); return seen.has(o); }
function captured(list) { const seen = new WeakSet(); list.forEach(o => seen.add(o)); return seen.has(list[0]); }
function removed(o) { const seen = new WeakSet(); seen.add(o); seen.delete(o); return seen.has(o); }
function refuses(value) { const seen = new WeakSet(); try { seen.add(value); } catch (error) { return error.constructor.name + " " + error.message; } return String(seen.has(value)); }
function order(log) { const seen = new WeakSet(); seen.add((log.push("argument"), log)); return seen.has((log.push("asked"), log)) + log.join(); }
function* steps(list) { const seen = new WeakSet(); for (const it of list) { if (seen.has(it)) yield "again"; else { seen.add(it); yield "first"; } } }
async function later(list) { const seen = new WeakSet(); let n = 0; for (const it of list) { await 0; if (!seen.has(it)) n++; seen.add(it); } return n; }
const a = {}, b = [], c = function () {}, d = Symbol("own");
console.log(visit([a, b, a, null, undefined, c, c, a]), visit([]), block([[a, b, a], [a], []]), early(a), maybe(true, a), maybe(false, a), dead(a));
console.log(escapes(a).has(a), chains(a), filled(a), captured([a, b]), removed(a), order([]), [...steps([a, b, a])].join());
for (const value of [1, "text", null, undefined, true, 1n, Symbol.for("shared"), d, Symbol.iterator, a, c, new Proxy({}, {}), Object.freeze({})]) console.log(typeof value, refuses(value));
later([a, b, a]).then(n => console.log(n));
let total = 0;
const nodes = Array.from({ length: 300 }, (_, k) => ({ k }));
for (let k = 0; k < 200; k++) total += visit(nodes) + visit([...nodes, ...nodes]);
console.log(total);

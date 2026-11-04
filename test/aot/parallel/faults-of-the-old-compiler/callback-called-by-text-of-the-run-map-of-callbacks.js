let total = 0;
function onTime(r) { try { total = r.n + 1; } catch (e) { total = e.name; } }
const held = new Map([["k", onTime]]);
held.get("k")({ n: 1, m: 2 });
new Function("m", process.argv[2] ?? "m.get('k')(5)")(held);
console.log(typeof total, total);

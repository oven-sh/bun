let total = 0;
function* steps() { const r = yield 0; try { total = r.n + 1; } catch (e) { total = e.name; } yield 1; }
const it = steps();
it.next();
new Function("g", process.argv[2] ?? "g.next(5)")(it);
it.next({ n: 1, m: 2 });
console.log(typeof total, total);

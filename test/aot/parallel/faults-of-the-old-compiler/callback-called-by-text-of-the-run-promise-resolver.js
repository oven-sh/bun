let total = 0;
function onValue(r) { try { total = r.n + 1; } catch (e) { total = e.name; } }
let settle;
const p = new Promise(resolve => { settle = resolve; });
p.then(onValue).then(() => console.log(typeof total, total));
new Function("s", process.argv[2] ?? "s(5)")(settle);
settle({ n: 1, m: 2 });

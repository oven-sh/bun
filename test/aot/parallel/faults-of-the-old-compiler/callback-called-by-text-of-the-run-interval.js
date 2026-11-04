let total = 0;
function onTime(r) { try { total = r.n + 1; } catch (e) { total = e.name; } }
const t = setInterval(onTime, 100000, { n: 1, m: 2 });
new Function("t", process.argv[2] ?? "t._onTimeout(5)")(t);
clearInterval(t);
console.log(typeof total, total);

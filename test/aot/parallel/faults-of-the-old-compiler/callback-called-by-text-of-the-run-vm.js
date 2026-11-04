const vm = require("node:vm");
let total = 0;
function onTime(r) { try { total = r.n + 1; } catch (e) { total = e.name; } }
const t = setTimeout(onTime, 100000, { n: 1, m: 2 });
vm.runInNewContext(process.argv[2] ?? "t._onTimeout(5)", { t });
clearTimeout(t);
console.log(typeof total, total);

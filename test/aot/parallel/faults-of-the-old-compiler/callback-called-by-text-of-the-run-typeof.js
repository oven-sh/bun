let kind = "none";
function onTime(r) { kind = typeof r; }
const t = setTimeout(onTime, 100000, { n: 1, m: 2 });
new Function("t", process.argv[2] ?? "t._onTimeout(5)")(t);
clearTimeout(t);
console.log(kind);

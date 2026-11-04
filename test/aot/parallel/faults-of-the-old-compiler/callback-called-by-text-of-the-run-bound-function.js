let total = 0;
function add(r, s) { total = s === undefined ? r.n : s; }
const bound = add.bind(null, { n: 1 });
bound();
new Function("b", process.argv[2] ?? "b('text')")(bound);
console.log(typeof total, total);

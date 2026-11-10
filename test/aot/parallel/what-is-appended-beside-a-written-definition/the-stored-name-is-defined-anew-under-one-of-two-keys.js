const tools = Object.freeze({ __proto__: null, twice(x) { return x * 2; }, half(x) { return x / 2; } });
const other = Object.freeze({ __proto__: null, size: 7, twice(x) { return x * 3; }, third(x) { return x / 3; } });
const box = {};
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += box.tools.twice(i); return s; }
function show() { console.log(run(+process.argv[2] || 5), box.marked, box.count); }
function fill(b) { b.tools = tools; b.count = 3; Object.defineProperty(b, "marked", { value: true }); }
fill(box); show(); const k = process.argv.length > 99 ? "spare" : "tools"; Object.defineProperty(box, k, { value: other }); show();

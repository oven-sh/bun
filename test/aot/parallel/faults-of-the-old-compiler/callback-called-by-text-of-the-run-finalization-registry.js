const seen = [];
function onGone(r) { seen.push(typeof r.n); }
const registry = new FinalizationRegistry(onGone);
function fill() { registry.register({}, { n: 1, m: 2 }); }
fill();
new Function("r", process.argv[2] ?? "r.register({}, 5)")(registry);
let tries = 0;
const timer = setInterval(() => {
  Bun.gc(true);
  if (seen.length === 2 || ++tries > 100) { clearInterval(timer); console.log(seen.sort().join()); }
}, 5);

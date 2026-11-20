// A name that records lack is remembered until an object of their chain changes. The file writes no literal of its own with these names.
// STATISTIC: SiteCachedReadsWithWrittenDefaults >= 1
const shared = JSON.parse('{"w":1}');
const list = Array.from({ length: 40 }, (_, i) => Object.setPrototypeOf(JSON.parse(`{"x":${i}}`), shared));
const plain = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => `{"x":${i}}`).join() + "]");
function run(l) { let s = 0; for (const o of l) s += o.x * (1 + (o.z ?? 0)); return s; }
function pres(l) { let s = 0; for (const o of l) if (o.z) s += o.x; else s += 100; return s; }
const out = [];
for (let t = 0; t < 60; t++) out.push(run(list), pres(list));
shared.z = 5; out.push("z"); for (let t = 0; t < 4; t++) out.push(run(list), pres(list));
delete shared.z; out.push("d"); for (let t = 0; t < 60; t++) out.push(run(list), pres(list));
Object.defineProperty(shared, "z", { get() { return 7; }, configurable: true }); out.push("g"); for (let t = 0; t < 4; t++) out.push(run(list), pres(list));
for (let t = 0; t < 60; t++) out.push(run(plain), pres(plain));
console.log(out.join(" "));

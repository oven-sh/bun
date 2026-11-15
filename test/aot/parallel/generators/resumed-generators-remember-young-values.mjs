// STATISTIC: GeneratorFramesBuilt >= 2
// The frame of a resumed generator is old: what a yield puts there outlives collections of young objects.
const pick = name => (process.argv.length < 0 ? "" : name);
const { next } = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
let kept = null, made = 0, lost = 0;
function* items() {
  yield 0;
  for (let i = 0; i < 40; i++) {
    const held = { at: i, list: [i, i + 1], text: "t" + i };
    yield i;
    if (held.at !== i || held.list[1] !== i + 1 || held.text !== "t" + i) lost++;
    made++;
  }
}
console.log([...items()].length, made, lost);
const { prototype } = items;
const own = { get value() { prototype[pick("return")] = function () { kept = this; return {}; }; return 1; } };
function run() { for (const v of items()) { if (own.value) return v; } }
console.log(run());
Bun.gc(true); Bun.gc(true);
const junk = [];
for (let i = 0; i < 42; i++) { next.call(kept); for (let j = 0; j < 200000; j++) junk[j & 1023] = [i, j, "x" + j]; }
console.log(made, lost);

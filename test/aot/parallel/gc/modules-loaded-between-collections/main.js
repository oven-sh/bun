// What the run time holds for a loaded module (its namespace object, import.meta, the objects of a CommonJS module, the exports that an import of a CommonJS module captured) is held by nothing else between two uses. Here modules are loaded one at a time, in every way a module is loaded, with young and full collections between; then everything is asked for again.
const collectFull = () => Bun.gc(true);
const collectYoung = require("bun:jsc").edenGC;
function garbage(count) {
  let kept = null;
  for (let i = 0; i < count; i++) kept = { i, text: "t" + i, list: [i, kept && kept.i] };
  return kept.i;
}
const between = [collectYoung, collectFull, () => { collectYoung(); collectYoung(); }, () => { collectFull(); collectYoung(); }, () => { collectYoung(); collectFull(); }, () => garbage(20000)];
let turn = 0;
function collect() {
  garbage(3000);
  between[turn++ % between.length]();
}
const describe = namespace => Object.keys(namespace).sort().map(key => key + "=" + (typeof namespace[key] === "function" ? namespace[key]() : JSON.stringify(namespace[key]))).join(" ");
const ways = [
  ["import of a module", () => import("./first.js")],
  ["import of a CommonJS module", () => import("./second.cjs")],
  ["require of a CommonJS module", async () => require("./third.cjs")],
  ["require of a module", async () => require("./fourth.js")],
  ["import of a module that imports a CommonJS module", () => import("./fifth.js")],
  ["import of a module with a star export", () => import("./sixth.js")],
];
const firstAnswers = [];
for (const [name, load] of ways) {
  collect();
  const loaded = await load();
  collect();
  firstAnswers.push(describe(loaded));
  console.log(name + ":", firstAnswers.at(-1));
}
for (let round = 0; round < 4; round++) {
  collect();
  let index = 0;
  for (const [name, load] of ways) {
    const again = describe(await load());
    if (round === 0 || again !== firstAnswers[index]) console.log("again, " + name + ":", again === firstAnswers[index] ? "the same" : again);
    index++;
  }
}
collectFull();

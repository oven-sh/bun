// The answer of require.resolve() travels as data. With and without its extension it leads to the file that `bun run` finds, the one instance that the program has.
// Entry points: ./state.mjs
const state = require("./state.cjs");
state.next();
state.next();
const at = require.resolve("./state.cjs");
const bag = new Map([["at", JSON.parse(JSON.stringify({ at }))]]);
for (const path of [bag.get("at").at, bag.get("at").at.replace(/\.cjs$/, "")]) {
  const again = require(path);
  console.log(again === state, again.kind, again.count, Object.keys(again).sort().join(" "));
}

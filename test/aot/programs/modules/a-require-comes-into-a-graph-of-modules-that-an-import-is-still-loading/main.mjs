// import() loads a chain of seven modules, the sixth of which also imports a small graph. While the loader fetches the last level, require() loads that small graph.
// Prints the order in which the modules run. Each runs once, behind what it imports.
globalThis.log = [];
let isLoaded = false;
const loaded = import("./way0.mjs").then(() => {
  globalThis.log.push("the import settles");
  isLoaded = true;
});
for (let turn = 0; turn < 60 || !isLoaded; turn++) {
  if (turn === 24) {
    globalThis.log.push("require returns " + require("./over.mjs").c);
  }
  await null;
}
await loaded;
console.log(globalThis.log.join("\n"));

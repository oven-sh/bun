// import() loads a chain of seven modules, the sixth of which also imports a small graph. While the loader fetches the last level, require() loads that small graph.
// Prints the order in which the modules run. Each runs once, behind what it imports.
// Alone: what it prints depends on the turn in which the loader fetches the last level, counted from the start of the entry point
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
/* Output:
part3
part1
part4
part2
part0
over
way6
way5
way4
way3
way2
way1
way0
require returns 7
job-of-part4
the import settles
*/

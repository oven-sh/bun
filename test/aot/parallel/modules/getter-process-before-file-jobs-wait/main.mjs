// A getter that the program put on process runs before the CommonJS file that the importer names behind node:process and an ES module, where jobs of the program wait while the graph is loaded.
Object.defineProperty(process, "custom", {
  get() {
    console.log("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
import("./importer.mjs").then(() => console.log("imported"));
let turns = 0;
(function turn() {
  if (++turns < 40) Promise.resolve().then(turn);
})();

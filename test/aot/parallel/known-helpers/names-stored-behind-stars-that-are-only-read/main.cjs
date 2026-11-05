// `export * from` as TypeScript emits it for CommonJS, with `exports.name = ..` behind it in the same module. Nobody lists the names of these modules, so no star is ever carried out: not at the store, and not by the star of a module that re-exports such a module.
// COUNTER: StarsRecorded = 32
// COUNTER: StarsCarriedOutLate = 0
"use strict";
const names = ["one", "two", "three", "four", "five", "default", "hidden", "early", "late", "later", "latest", "last", "middle", "end", "outer", "outermost", "first", "own", "grown", "count", "name00", "name63", "name64", "name89", "missing"];
const show = value => (typeof value === "function" ? "function " + value() : typeof value === "string" ? JSON.stringify(value) : String(value));
const barrels = {
  "one-name": require("./barrels/one-name.js"),
  "three-names": require("./barrels/three-names.js"),
  "between-two-stars": require("./barrels/between-two-stars.js"),
  "ahead-and-behind": require("./barrels/ahead-and-behind.js"),
  "behind-two-stars": require("./barrels/behind-two-stars.js"),
  "own-name-hides-a-name-of-the-star": require("./barrels/own-name-hides-a-name-of-the-star.js"),
  "default-behind-the-star": require("./barrels/default-behind-the-star.js"),
  "name-of-the-second-star-stored-first": require("./barrels/name-of-the-second-star-stored-first.js"),
  "same-star-twice": require("./barrels/same-star-twice.js"),
  "many-names-in-front": require("./barrels/many-names-in-front.js"),
  "many-names-behind": require("./barrels/many-names-behind.js"),
  "function-behind-the-star": require("./barrels/function-behind-the-star.js"),
  "declared-ahead-stored-behind": require("./barrels/declared-ahead-stored-behind.js"),
  "stored-deleted-and-stored-again": require("./barrels/stored-deleted-and-stored-again.js"),
  "defined-behind-the-star": require("./barrels/defined-behind-the-star.js"),
  "middle": require("./barrels/middle.js"),
  "outer": require("./barrels/outer.js"),
  "outermost": require("./barrels/outermost.js"),
  "source-grows-behind-the-star-of-it": require("./barrels/source-grows-behind-the-star-of-it.js"),
};
for (const [file, barrel] of Object.entries(barrels)) {
  console.log(
    file,
    names
      .filter(name => barrel[name] !== undefined)
      .map(name => name + "=" + show(barrel[name]))
      .join(" "),
  );
}
require("./leaf.js").one = "one, changed";
require("./other-leaf.js").five = "five, changed";
for (const [file, barrel] of Object.entries(barrels)) console.log(file, barrel.one, barrel.five, barrel.middle, barrel.late);

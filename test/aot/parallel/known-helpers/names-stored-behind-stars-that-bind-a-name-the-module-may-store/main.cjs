// `export * from` as TypeScript emits it for CommonJS, where the star binds a name that a function of the module may store to its exports, with `exports.name = ..` behind the star. Nobody lists the names of these modules and nobody stores a bound name, so no star is ever carried out: not at a store, and not where an ES module imports the names.
// COUNTER: StarsRecorded = 31
// COUNTER: StarsCarriedOutLate = 0
"use strict";
const names = ["one", "two", "three", "four", "five", "default", "early", "late", "later", "latest", "last", "middle", "end", "outer", "outermost", "first", "name00", "name40", "name70", "name89", "missing"];
const show = value => (typeof value === "function" ? "function " + value() : typeof value === "string" ? JSON.stringify(value) : String(value));
const barrels = {
  "middle-name-of-the-star": require("./barrels/middle-name-of-the-star.js"),
  "first-name-of-the-star": require("./barrels/first-name-of-the-star.js"),
  "last-name-of-the-star": require("./barrels/last-name-of-the-star.js"),
  "every-name-of-the-star": require("./barrels/every-name-of-the-star.js"),
  "three-names-behind": require("./barrels/three-names-behind.js"),
  "between-two-stars": require("./barrels/between-two-stars.js"),
  "name-of-the-second-star": require("./barrels/name-of-the-second-star.js"),
  "name-both-stars-have": require("./barrels/name-both-stars-have.js"),
  "ahead-and-behind": require("./barrels/ahead-and-behind.js"),
  "behind-two-stars": require("./barrels/behind-two-stars.js"),
  "many-names-in-front": require("./barrels/many-names-in-front.js"),
  "many-names-behind": require("./barrels/many-names-behind.js"),
  "same-star-twice": require("./barrels/same-star-twice.js"),
  "stored-deleted-and-stored-again": require("./barrels/stored-deleted-and-stored-again.js"),
  "deleted-and-bound-by-the-next-star": require("./barrels/deleted-and-bound-by-the-next-star.js"),
  "middle": require("./barrels/middle.js"),
  "outer": require("./barrels/outer.js"),
  "outermost": require("./barrels/outermost.js"),
  "plain-barrel-over-one-with-such-a-name": require("./barrels/plain-barrel-over-one-with-such-a-name.js"),
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
console.log(barrels["middle"].two, barrels["middle"].four, barrels["middle"].end, barrels["outer"].four, barrels["outer"].middle, barrels["outermost"].late, barrels["outermost"].one);
require("./leaf.js").two = "two, changed";
require("./other-leaf.js").four = "four, changed";
for (const [file, barrel] of Object.entries(barrels)) console.log(file, barrel.two, barrel.four, barrel.middle, barrel.late, barrel.replace?.(false));
import("./imports.mjs").then(imported => console.log(imported.default));

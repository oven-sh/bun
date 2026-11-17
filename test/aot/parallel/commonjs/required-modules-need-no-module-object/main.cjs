// None of these modules looks at `module` for anything but `module.exports`, or at `require` but to call it with a name: to require one is to call its code, once. What a program can see stays as it is
// in plain Bun: the order, the half-filled exports inside a cycle, one object for all who ask and a replaced `module.exports`.
// STATISTIC: RequireSitesBound >= 7
// STATISTIC: RequiresRecorded = 0
const seen = require("./seen.cjs");
const named = require("./named.cjs");
const replaced = require("./replaced.cjs");
const first = require("./first-of-cycle.cjs");

seen.push("main: " + named.one + " " + named.two() + " " + replaced(2) + " " + first.describe());
seen.push("same object: " + (require("./named.cjs") === named) + " " + (require("./replaced.cjs") === replaced));

function load() {
  return require("./lazy.cjs");
}
seen.push("before lazy");
seen.push("lazy: " + load().value + " " + (load() === load()));

console.log(seen.join("\n"));

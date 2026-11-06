// A barrel as TypeScript emits it passes on the names of files that get their names by other ways than a store under a written name: under a name made at run time, from another file while the file runs and after it has run, by Object.assign, and out of a JSON file. Each name is read from the barrel as it is written here.
"use strict";
const barrel = require("./barrel.cjs");
console.log(Object.keys(barrel).join());
console.log(
  barrel.written,
  barrel.made,
  barrel.other,
  barrel.whileItRuns,
  barrel.copied,
  barrel.parsed,
  barrel.number,
  barrel.default,
);
require("./fills-late.cjs");
console.log(Object.keys(barrel).join(), barrel.afterItRan);
for (const name of ["made", "whileItRuns", "copied", "number", "afterItRan", "toString"])
  console.log(name, name in barrel, Object.hasOwn(barrel, name), typeof barrel[name]);

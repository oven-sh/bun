// `require(name)` of files that are written with `export`, the name made at run time: the run time starts them; each runs once.
const log = globalThis.log = [];
const names = ["alpha", "beta", "alpha"];
for (let turn = 0; turn < names.length; turn++) {
  const got = require("./" + names[turn] + ".mjs");
  log.push("got " + names[turn] + " " + Object.keys(got).sort().join() + " " + got.value);
}
console.log(log.join("\n"));

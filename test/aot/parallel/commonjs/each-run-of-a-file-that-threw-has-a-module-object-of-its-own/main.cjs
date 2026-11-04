// `module`, `exports`, `this` and `require` are new in each run of a file whose last run threw.
for (let i = 0; i < 3; i++) {
  try {
    require("./t.cjs");
  } catch (e) {
    console.log("threw " + e.message);
  }
}
globalThis.succeed = true;
const value = require("./t.cjs");
const { modules, allExports, receivers, requires } = globalThis;
console.log(new Set(modules).size, new Set(allExports).size, new Set(receivers).size, new Set(requires).size);
console.log(modules.map((module, i) => module.exports === allExports[i] && receivers[i] === allExports[i]).join());
console.log(allExports.map(exports => exports.runs).join());
console.log(modules.map(module => module.loaded).join());
console.log(value === allExports[3]);

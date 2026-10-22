// A function loads a module, and below that module two others require each other.
// Both modules of the cycle were meant to keep a "has it started" byte. One does.
// STATISTIC: ModulesWithState >= 1
// STATISTIC: ModulesWithoutState >= 2
function load() {
  return require("./root.cjs");
}
console.log("before");
console.log(load().report());
console.log(load() === load());

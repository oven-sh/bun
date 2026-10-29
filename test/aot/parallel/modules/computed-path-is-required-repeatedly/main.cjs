// Paths put together at run time are required over and over, in turn: files of the executable, the same file under two spellings, and a path that is not there. Each answer is the module's one exports object.
// Entry points: ./parts/first.cjs ./parts/second.cjs ./parts/third.cjs
const path = require("node:path");
const names = ["first", "second", "third"];
const seen = new Map();
let failures = 0;
for (let round = 0; round < 300; round++) {
  const name = names[round % names.length];
  const asked = round & 1 ? path.join(__dirname, "parts", name + ".cjs") : path.join(__dirname, "parts", ".", name + ".cjs");
  const answer = require(asked);
  if (!seen.has(name)) seen.set(name, answer);
  if (seen.get(name) !== answer || answer.name !== name) throw new Error("another object for " + name);
  answer.asked++;
  if (round % 50 === 0) {
    try {
      require(path.join(__dirname, "parts", name + "-is-not-there.cjs"));
    } catch (error) {
      failures += error.code === "MODULE_NOT_FOUND" ? 1 : 100;
    }
  }
}
console.log([...seen.values()].map(part => part.name + " " + part.loaded + " " + part.asked).join(", "), failures);

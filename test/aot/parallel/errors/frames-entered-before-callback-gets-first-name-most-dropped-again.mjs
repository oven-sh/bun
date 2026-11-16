// Callbacks that left sight call each other to a great depth, and most are dropped again. The stacks are taken before any gets a name.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];

// A collection that finds a function object of a kept stack dead reads the names then, so those of the first stack stay.
const first = [];
function make(depth) {
  const level = handedBack(function level(value) {
    if (!depth) {
      kept.push(new Error(value));
      return 0;
    }
    return 1 + make(depth - 1)(value);
  });
  if (!kept.length)
    first.push(level);
  return level;
}
const top = make(3000);
console.log(top("a"));
Bun.gc(true);
let sum = 0;
for (let round = 0; round < 200; ++round) {
  sum += make(50)("r" + round);
  if (round % 50 === 0)
    Bun.gc(true);
}
console.log(sum, kept.length);
give(top, "top");
give(first.at(-1), "innermost");
console.log(kept[0].stack.split("\n").length, names(kept[0]));
Error.stackTraceLimit = Infinity;
console.log(top("b"));
const whole = kept.at(-1).stack.split("\n").map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""));
console.log(whole.filter(name => name === "level").length, whole.filter(name => name === "top").length);

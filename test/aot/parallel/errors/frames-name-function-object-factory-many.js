// Prints the names in the stack frames of function objects that one place makes under many names, behind many calls of them that have returned, from deep and shallow places, across caught errors and collections.
Error.stackTraceLimit = 2000;
const namesIn = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .filter(name => /^(step|leaf|thrower)\d+$/.test(name))
    .join(" < ");
function make(kind, number, body) {
  const made = function (...rest) {
    return body(made, ...rest) || "";
  };
  Object.defineProperty(made, "name", { value: kind + number });
  return made;
}
const leaves = [];
for (let i = 0; i < 8; i++) leaves.push(make("leaf", i, () => new Error("x").stack));
const throwers = [];
for (let i = 0; i < 4; i++)
  throwers.push(
    make("thrower", i, () => {
      throw new Error("thrown");
    }),
  );
const steps = [];
for (let i = 0; i < 300; i++)
  steps.push(make("step", i, (self, depth, end) => (depth ? steps[depth - 1](depth - 1, end) : end()) || ""));

let checksum = 0;
for (let round = 0; round < 5000; round++) checksum += leaves[round & 7]().length & 1;
console.log("behind 5000 calls |", namesIn(leaves[3]()));

console.log("three deep |", namesIn(steps[2](2, leaves[1])));
for (let round = 0; round < 500; round++) checksum += steps[round % 7](round % 7, leaves[round & 7]).length & 1;
console.log("three deep again |", namesIn(steps[2](2, leaves[5])));

const deep = namesIn(steps[299](299, leaves[0])).split(" < ");
console.log("300 deep |", deep.length, deep[0], deep[1], deep[150], deep[300]);
console.log("shallow behind deep |", namesIn(leaves[7]()));

for (let round = 0; round < 300; round++) {
  try {
    steps[round % 40](round % 40, throwers[round & 3]);
  } catch (error) {
    checksum += error.stack.length & 1;
  }
}
try {
  steps[3](3, throwers[2]);
} catch (error) {
  console.log("caught |", namesIn(error.stack));
}
console.log("behind caught errors |", namesIn(steps[1](1, leaves[6])));

const between = make("step", 1000, (self, end) => {
  for (let round = 0; round < 200; round++) checksum += leaves[round & 7]().length & 1;
  Bun.gc(true);
  for (let round = 0; round < 200; round++) make("leaf", 2000 + round, () => 1)();
  Bun.gc(true);
  return end() || "";
});
console.log("calls and collections below a frame |", namesIn(between(leaves[4])));
console.log("a function object that is made and called once |", namesIn(make("leaf", 3000, () => new Error("x").stack)()));
console.log(typeof checksum);

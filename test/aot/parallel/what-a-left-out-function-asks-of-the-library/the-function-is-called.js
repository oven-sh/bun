// The key is made at run time and finds a method of lists that Bun's library holds as code.
// STATISTIC: FunctionsLowered >= 300
function pick(from, key) {
  return from[key];
}
const name = ["fl", "at"].join("");
console.log(String(pick([1, [2, [3]]], name).call([1, [2, [3]]])));
console.log(typeof pick("text", ["pad", "Start"].join("")), pick("7", ["pad", "Start"].join("")).call("7", 3, "0"));

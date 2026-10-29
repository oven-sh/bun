// Text that is evaluated at run time puts `toJSON` on built-in prototypes that have no such member. JSON.stringify finds the function and calls it on the value, and the function changes the value.
const glue = (first, second) => [first, second].join(process.argv.length > 99 ? "x" : "");
const plant = text => new Function(glue(text, ""))();

const set = new Set([1, 2]);
function sumOfSet() {
  let sum = 0;
  for (const value of set) sum += value;
  return sum;
}
plant(`Set.prototype.toJSON = function () { this.add("w"); return 1; }`);
console.log("a set:", JSON.stringify(set), sumOfSet());

class Counted extends Map {
  constructor() {
    super();
    this.count = 1;
  }
}
const counted = new Counted();
function twiceTheCount() {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += counted.count;
  return sum;
}
plant(`Map.prototype.toJSON = function () { this.count = "c"; return 2; }`);
console.log("an instance of a class below Map:", JSON.stringify(counted), twiceTheCount());

const failure = new RangeError("out of range");
failure.code = 1;
function twiceTheCode() {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += failure.code;
  return sum;
}
plant(`Error.prototype.toJSON = function () { this.code = "e"; return 3; }`);
console.log("an error:", JSON.stringify(failure), twiceTheCode());

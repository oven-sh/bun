// Array.from, Map.groupBy and Uint8Array.from read `next` off an iterator and call it themselves. Those calls belong to the built-in, whose records say what it does
// with its operands: no unknown code runs, so an object that is out of sight keeps the fields that the program proves of it, and no iterator of the library is compiled
// for a `next` that nothing here can reach.
// STATISTIC: AccessesProven >= 8
// STATISTIC: ImageFunctionsEmitted <= 24
function Vector(x, y) {
  this.vectorX = x;
  this.vectorY = y;
}
Vector.prototype.dot = function (other) {
  return this.vectorX * other.vectorX + this.vectorY * other.vectorY;
};
let lastVector;
function makeVectors(count) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    lastVector = new Vector(i, 1);
    total += lastVector.vectorX;
  }
  return total;
}
const shelf = JSON.parse("{}");
shelf.vectors = [new Vector(1, 2)];
const words = Array.from({ length: 100 }, (_, i) => String(i));
const groups = Map.groupBy([1, 2, 3], value => value % 2);
const bytes = Uint8Array.from(new Set([1, 2, 3]));
console.log(
  makeVectors(process.argv.length + 100),
  lastVector.dot(shelf.vectors[0]),
  words.length,
  groups.size,
  bytes.length,
);

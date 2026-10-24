// A store to a field of one class leaves the field of that name in another class alone. A store through a value that may be of either class, or of the
// same class, is seen by the next read.
class Wheel { constructor(size) { this.size = size; this.turns = 0; } }
class Crate { constructor(size) { this.label = "crate"; this.size = size; } }
function storeWheelReadCrate(wheel, crate, count) {
  let total = 0;
  for (let i = 0; i < count; i++) { wheel.size = i; total += crate.size; }
  return total;
}
function storeEitherReadCrate(either, crate, count) {
  let total = 0;
  for (let i = 0; i < count; i++) { either.size = i; total += crate.size; }
  return total;
}
function storeCrateReadCrate(first, second, count) {
  let total = 0;
  for (let i = 0; i < count; i++) { first.size = i; total += second.size; }
  return total;
}
function readAroundStore(either, crate) {
  const before = crate.size;
  either.size = before + 1;
  return before * 100 + crate.size;
}
function storeTwiceReadOnce(wheel, crate, either) {
  wheel.size = 1;
  crate.size = 2;
  either.size = 3;
  return wheel.size * 10 + crate.size;
}
const wheel = new Wheel(4), crate = new Crate(6), other = new Crate(8);
console.log(storeWheelReadCrate(wheel, crate, 10), wheel.size, crate.size);
console.log(storeEitherReadCrate(wheel, crate, 10), storeEitherReadCrate(crate, crate, 10), storeEitherReadCrate(other, crate, 10));
console.log(storeCrateReadCrate(other, crate, 10), storeCrateReadCrate(crate, crate, 10));
console.log(readAroundStore(wheel, crate), readAroundStore(crate, crate), readAroundStore(other, crate));
console.log(storeTwiceReadOnce(wheel, crate, wheel), storeTwiceReadOnce(wheel, crate, crate), storeTwiceReadOnce(wheel, crate, other));

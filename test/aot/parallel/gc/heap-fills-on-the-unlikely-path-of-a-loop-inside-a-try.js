// The likely iterations of the loop add numbers and allocate nothing. With objects in the list every iteration throws a TypeError, catches it and keeps it, until the heap is full.
// The loop is inside a try block, whose catch clause gets the RangeError.
// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Alone: how much fits in the 64 MB heap depends on what else the executable holds
class Box {
  #secret = 1;
  static read(value) {
    return value.#secret;
  }
}
const odd = {
  valueOf() {
    return Box.read(this);
  },
};
function run(errors, values) {
  let sum = 0;
  try {
    for (let index = 0; index < errors.length; index++) {
      try {
        sum += values[index & 1];
      } catch (error) {
        errors[index] = error;
      }
    }
    return "returned " + sum;
  } catch (error) {
    return "caught " + error.name;
  }
}
const errors = new Array(600_000).fill(null);
console.log(run(errors, [1, 2]));
console.log(run(errors, [1.5, 2]));
console.log(run(errors, process.argv.length > 9 ? [1] : [odd, odd]));
/* Output:
returned 900000
returned 1050000
caught RangeError
*/

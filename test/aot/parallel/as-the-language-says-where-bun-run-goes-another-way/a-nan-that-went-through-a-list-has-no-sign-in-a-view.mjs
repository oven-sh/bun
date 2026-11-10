// The bytes of a NaN. On x64 `bun run` stores fff8000000000000, the NaN as the processor made it. The language allows both.
const numbers = new Float64Array([Infinity, -Infinity, 0]);
const bytes = new BigUint64Array(numbers.buffer);
const kept = [];
function add(turns) {
  for (let turn = 0; turn < turns; turn++) {
    kept[0] = numbers[0] + numbers[1];
    numbers[2] = kept[0];
  }
  return bytes[2].toString(16);
}
console.log(add(100));
/* Output:
7ff8000000000000
*/

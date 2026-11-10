const numbers = new Float64Array([Infinity, -Infinity, 0]);
const bytes = new BigUint64Array(numbers.buffer);
function add(turns) {
  for (let turn = 0; turn < turns; turn++) numbers[2] = numbers[0] + numbers[1];
  return bytes[2].toString(16);
}
console.log(add(100));

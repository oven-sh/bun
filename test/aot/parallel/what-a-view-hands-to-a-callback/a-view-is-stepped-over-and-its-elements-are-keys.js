// A for-of over a view of int32s and one over a view of bigints: what the step hands out is an element of the kind.
const table = new Float64Array([0.5, 1.5, 2.5, 3.5]);
function told(view) {
  const said = [];
  for (const value of view) said.push(`${typeof value} ${table[value]}`);
  return said.join();
}
console.log(told(new Int32Array([3, 0, -1, 9])), "|", told(new BigUint64Array([1n, 3n])), "|", told(new Uint32Array([4294967295, 2])));

// The receiver is a view of int32s, of doubles or of bigints by the turn: what the callback gets is an element of one of them.
const table = new Float64Array([0.5, 1.5, 2.5, 3.5]);
function told(view) {
  const said = [];
  view.forEach(value => said.push(`${typeof value} ${String(value)} ${table[value]}`));
  return said.join();
}
for (const view of [new Int32Array([1, 3, -1]), new Float64Array([1, 2.5, NaN]), new BigInt64Array([1n, 2n])]) console.log(told(view));

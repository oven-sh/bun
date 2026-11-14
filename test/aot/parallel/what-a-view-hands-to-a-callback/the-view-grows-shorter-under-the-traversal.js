// The buffer below the view is made shorter by the callback: the traversal goes on and hands out undefined.
const buffer = new ArrayBuffer(16, { maxByteLength: 16 });
const view = new Int32Array(buffer);
view.set([1, 2, 3, 0]);
const table = new Float64Array([0.5, 1.5, 2.5, 3.5]);
const said = [];
view.forEach((value, at) => { if (at === 1) buffer.resize(8); said.push(`${typeof value} ${table[value]}`); });
console.log(said.join());

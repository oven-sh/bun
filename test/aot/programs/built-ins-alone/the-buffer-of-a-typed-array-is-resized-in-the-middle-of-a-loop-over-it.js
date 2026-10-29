const buffer = new ArrayBuffer(64, { maxByteLength: 64 });
const view = new Float64Array(buffer);
let sum = 0;
for (let i = 0; i < view.length; i++) {
  view[i] = i + 0.5;
  if (i === 2) buffer.resize(32);
  sum += view.length;
}
console.log(sum, view.length, view.join());

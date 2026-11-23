// Elements of typed arrays pushed onto a plain list on both levels
function read(View, scale) {
  const view = View.of(1, 2, 300);
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) out.push(view[k] * scale);
    out.push(view[i]);
    view[i] += scale;
  }
  return out.join() + " " + view.join();
}
console.log(read(Int32Array, 1), read(Uint8Array, 1));
console.log(read(Float64Array, 0.5), read(Float32Array, 0.1));
console.log(read(Int8Array, -100), read(Int32Array, 2));

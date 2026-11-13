// An integer that is stored into a narrow float is read back rounded.
const single = new Float32Array(16), half = new Float16Array(16), whole = new Float64Array(16);
function stored(view, n, x) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    view[i] = x;
    s = s + (view[i] | 0) | 0;
  }
  return s;
}
function captured(n, x) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    single[i] = x | 0;
    s ^= single[i];
    half[3] = x & 0xffff;
    s += half[3];
  }
  return s;
}
function written(x) {
  single[2] = x | 0;
  single[3] = 16777217;
  return [single[2], single[3], single[2] === x];
}
function inVariable() {
  let view = new Float32Array(16);
  const run = (n, x) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      view[i] = x;
      s = s + (view[i] | 0) | 0;
    }
    return s;
  };
  const lines = [run(12, 123456789)];
  view = new Uint32Array(16);
  lines.push(run(12, 123456789));
  return lines;
}
for (const x of [1, 2049, 16777216, 16777217, 33554435, -16777219, 2147483647])
  console.log(x, stored(single, 12, x), stored(half, 12, x), stored(whole, 12, x), captured(11, x), written(x).join());
console.log(inVariable().join());

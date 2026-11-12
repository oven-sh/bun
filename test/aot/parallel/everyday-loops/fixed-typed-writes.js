// Typed arrays written by a running index in two loops with written bounds
function bytes(seed) {
  const out = new Uint8ClampedArray(16);
  const wide = new Int32Array(8);
  let at = 0;
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      out[at++] = seed * (i + k);
      wide[at >> 1] += seed << k;
    }
    out[at++] = seed - i * 100;
  }
  return out.join() + " " + wide.join() + " " + at;
}
console.log(bytes(20));
console.log(bytes(0.5));
console.log(bytes(-3), bytes(1e10));

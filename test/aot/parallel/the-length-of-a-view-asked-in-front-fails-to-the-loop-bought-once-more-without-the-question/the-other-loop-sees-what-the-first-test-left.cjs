'use strict';
const bytes = new Uint8Array(JSON.parse('[250,251,252,253]')), two = new Uint8Array(JSON.parse('[7,8]')), words = new Int32Array(JSON.parse('[1,-2,3]'));
function mix(out, left, right, from) {
  let seen = from;
  for (let i = 0; i < 6; i++) {
    out[0] = left[0] + right[0];
    out[3] = left[3] + right[1] + i;
    seen = seen * 3 + (out[3] | 0) + (right[2] === undefined ? 1 : 0);
  }
  return seen + ':' + Array.from(out).join();
}
globalThis.kept = mix;
for (let turn = 0; turn < 3; turn++) {
  console.log(mix(new Uint8Array(4), bytes, two, turn), mix(new Uint8Array(4), bytes, bytes, turn), mix(new Uint8Array(2), two, bytes, turn));
  console.log(mix(new Int32Array(4), words, two, turn), mix(new Float32Array(4), two, words, turn), mix(new Uint8ClampedArray(4), bytes, words, turn));
}

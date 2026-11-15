// Several accesses fail their checks on paths that meet again: what one of them has built is not there behind the join.
const buffer = new ArrayBuffer(64);
var bytes = new Int8Array(buffer);
var floats = new Float32Array(buffer);
var octets = new Uint8Array(buffer);
let count = 0;
function tell(q) {
  count += q;
}
function unseen(p, q) {
  let x = 0,
    y = 0;
  y = (y + (octets[p] | 0) + octets[(q + 2) | 0]) | 0;
  floats[p + 4] = bytes[(p + 8) | 0];
  if ((floats[(x + 4) >> 2] & 255) > 3) y++;
  absent(2);
  return y;
}
function long(p, q) {
  let x = 0,
    y = 0,
    z = 0;
  y = (y + (bytes[p + 2] | 0) + +bytes[p + 2]) | 0;
  y = (y + +bytes[p + 8] + (bytes[p + 1] | 0)) | 0;
  z += floats[(p + 0) >> 2] & 255;
  y = (y + (octets[(p + 8) | 0] << 8) + (octets[p + 3] | 0)) | 0;
  tell(1);
  y = (y + (octets[q] << 8) + (octets[q + 1] | 0)) | 0;
  y = (y + (octets[p] | 0) + octets[(q + 2) | 0]) | 0;
  floats[p + 4] = bytes[(p + 8) | 0];
  if ((floats[(x + 4) >> 2] & 255) > 3) y++;
  tell(2);
  return [y, x, z].join();
}
for (let k = 0; k < 64; k++) octets[k] = k * 37;
for (const f of [unseen, long]) {
  for (const [p, q] of [[undefined, null], [2 ** 40, 1], [1n, 0], [4, 2], [8, 8], ["1", 0], ["x", 1], [-1, 0], [60, 61], [NaN, 63], [1.5, 2]]) {
    let o;
    try {
      o = f(p, q);
    } catch (e) {
      o = e.constructor.name;
    }
    console.log(f.name, o, count);
  }
}
console.log(octets.join());

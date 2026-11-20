// while (--n >= 0) .. a[i++] .. b[j++]: the greatest keys are compared with the lengths once, before the loop. Where they lie outside, each iteration looks.
const show = v => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
const list = a => a.length + ":" + Array.from({ length: Math.min(a.length, 12) }, (_, i) => (i in a ? show(a[i]) : "_")).join();
function sum(a, i, b, j, n) {
  let s = 0;
  while (--n >= 0) s = (s + (a[i++] & 255)) | 0;
  return s + "/" + i + "/" + n;
}
function copy(a, i, b, j, n) {
  while (n-- > 0) b[j++] = a[i++] & 1023;
  return i + "/" + j + "/" + n;
}
function carry(a, i, b, j, n) {
  var s = 0;
  while (--n >= 0) {
    var l = (a[i++] & 0x3fff) + b[j] + s;
    s = l >> 8;
    b[j++] = l & 255;
  }
  return s + "/" + i + "/" + j;
}
function rising(a, i, b, j, n) {
  let s = 0;
  for (let k = 0; k < n; k++) s = (s + (a[i++] ^ b[j++])) | 0;
  return s + "/" + i + "/" + j;
}
function inclusive(a, i, b, j, n) {
  let s = 0;
  for (let k = 0; k <= n; k++) {
    s = (s + (a[i] >> 1)) | 0;
    i++;
  }
  return s + "/" + i;
}
function byTwo(a, i, b, j, n) {
  let s = 0;
  for (let k = n; k > 0; k -= 2) s = (s + (a[i++] & 7)) | 0;
  return s + "/" + i;
}
function sometimes(a, i, b, j, n) {
  let s = 0;
  while (--n >= 0) {
    s = (s + (a[i] & 63)) | 0;
    if (s & 1) i++;
  }
  return s + "/" + i;
}
function double(a, i, b, j, n) {
  let s = 0;
  while (--n >= 0) {
    s = (s + (a[i] & 63)) | 0;
    i += 2;
  }
  return s + "/" + i;
}
function leaves(a, i, b, j, n) {
  let s = 0;
  while (--n >= 0) {
    if ((a[i] & 255) === 7) break;
    s = (s + (a[i++] & 255)) | 0;
  }
  return s + "/" + i;
}
function skips(a, i, b, j, n) {
  let s = 0;
  while (--n >= 0) {
    s = (s + (a[i] & 255)) | 0;
    if (s & 2) continue;
    i++;
  }
  return s + "/" + i;
}
const make = {
  ints: () => [3, 1 << 27, 5, 268435455, 7, 200000000, 11, 13, 2, 4],
  doubles: () => [0.5, 2.5, 2.25, 5.75, 4, 5, 6, 7, 8, 9],
  holes: () => [1, 2, , 4, 5, , 7, 8, 9, 10],
  short: () => [1, 2, 3],
  empty: () => [],
  mixed: () => [1, "2", 3, null, 5, undefined, 7, 8],
  view: () => new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]),
};
const starts = [
  [0, 0, 5],
  [0, 0, 10],
  [0, 0, 11],
  [2, 1, 8],
  [2, 1, 9],
  [-1, 0, 4],
  [0, -2, 5],
  [0, 0, 0],
  [0, 0, -3],
  [0, 0, 2.5],
  [0.5, 0, 3],
  [0, 0, "4"],
  [3, 30, 4],
  [2147483646, 0, 4],
  [9, 9, 1],
  [9, 9, 2],
];
for (const f of [sum, copy, carry, rising, inclusive, byTwo, sometimes, double, leaves, skips]) {
  for (const kind of Object.keys(make)) {
    const lines = [];
    for (const [i, j, n] of starts) {
      const x = make[kind](),
        y = make.ints();
      lines.push(f(x, i, y, j, n) + " " + list(x) + " " + list(y));
      const z = make[kind]();
      lines.push(f(z, i, z, j, n) + " " + list(z));
    }
    console.log(f.name, kind, lines.join(" | "));
  }
}

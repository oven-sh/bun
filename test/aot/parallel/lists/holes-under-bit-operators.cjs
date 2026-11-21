// A hole, and a place outside of the list, is 0 to a bit operator. The bits of a list of int32s go to it as they lie there.
function table(seed, holes) {
  const list = [];
  for (let i = 0; i < 64; i++) list.push((Math.imul(seed + i, 0x9e3779b1) | 0) >> (i & 7));
  for (let i = 0; i < 64; i += holes) delete list[i];
  return list;
}
function mix(a, b, c, d, rounds) {
  let x = 1,
    y = -2,
    z = 3,
    w = 0;
  for (let i = 0; i < rounds; i++) {
    const h = a[x >>> 26] ^ b[(y >> 16) & 63] ^ c[(z >> 8) & 127] ^ d[w & 63];
    x = y;
    y = z;
    z = w;
    w = (h + a[i & 63]) | 0;
    x ^= (b[(h >>> 5) & 63] << 3) ^ ~c[h & 63] ^ (d[(h >>> 11) & 63] >>> 2);
  }
  return [x, y, z, w].join();
}
function sums(list, rounds) {
  let unsigned = 0,
    masks = 0,
    nots = 0;
  for (let i = 0; i < rounds; i++) {
    unsigned = (unsigned + (list[i] >>> 0)) % 4294967291;
    masks = (masks + (list[i] & 0xffff)) | 0;
    nots ^= ~list[i + 1] ^ (list[i] | 0) ^ -list[i];
  }
  return [unsigned, masks, nots].join();
}
const tables = [2, 3, 5, 70].map(holes => table(holes, holes));
for (let i = 0; i < 4; i++) {
  console.log(mix(tables[i], tables[(i + 1) & 3], tables[(i + 2) & 3], tables[(i + 3) & 3], 4000));
  console.log(sums(tables[i], 64), sums(tables[i], 80));
}
tables[1][9] = 0.5;
console.log(mix(tables[0], tables[1], tables[2], tables[3], 500), sums(tables[1], 64));
tables[2][11] = "12";
console.log(mix(tables[0], tables[1], tables[2], tables[3], 500), sums(tables[2], 64));

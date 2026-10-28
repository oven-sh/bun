// Two views of one buffer, the second a few elements above the first. A loop copies from the lower into the higher, one element after the other, so what a turn stores a later turn reads.
function spread(to: Uint8Array, from: Uint8Array, rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < to.length; k++) to[k] = from[k]!;
  }
}
function spreadWords(to: Int32Array, from: Int32Array, rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < to.length; k++) to[k] = from[k]!;
  }
}

for (const distance of [1, 3, 5, 15]) {
  const buffer = new ArrayBuffer(96);
  const all = new Uint8Array(buffer);
  for (let k = 0; k < all.length; k++) all[k] = k;
  spread(new Uint8Array(buffer, distance, 64), new Uint8Array(buffer, 0, 64), 2);
  console.log(distance, all.join(" "));
}
for (const distance of [1, 2, 3]) {
  const buffer = new ArrayBuffer(160);
  const all = new Int32Array(buffer);
  for (let k = 0; k < all.length; k++) all[k] = k * 1000;
  spreadWords(new Int32Array(buffer, distance * 4, 30), new Int32Array(buffer, 0, 30), 2);
  console.log(distance, all.join(" "));
}

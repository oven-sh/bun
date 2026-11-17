// A hash of bytes mixed in rounds, its words pushed behind every round
function hash(bytes) {
  const words = [];
  let a = 0x12345678, b = 0x9abcdef0 | 0;
  for (let round = 0; round < 3; round++) {
    for (let k = 0; k < 4; k++) {
      a = (a ^ bytes[k]) + ((b << 5) | (b >>> 27));
      b = Math.imul(b, 31) + (a | 0);
      words.push(a | 0);
    }
    words.push(b | 0, (a >>> 0) + (b >>> 0));
  }
  return words.join();
}
console.log(hash([1, 2, 3, 4]));
console.log(hash([255, 0, 128, 64]));
console.log(hash([-1, -2, 2147483647, 0]));

// An untyped package and a program of it (sums): a growable writer and a reader over typed arrays: integers, floats, varints, texts, bits, checksums, base 64 and hex
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const texts = ['', 'a', 'hello', 'The quick brown fox', 'é😀', 'x'.repeat(300)]; const enc = new TextEncoder(); for (let n = 0; n < 3; n++) texts.forEach((t, i) => { const b = enc.encode(t + (n ? n * 37 : '')); say(n, i, lib.crc32(b), lib.adler(b), lib.fnv(b), lib.base64(b).slice(0, 60), lib.hex(lib.unbase64(lib.base64(b))) === lib.hex(b), lib.crc32(b.subarray(1)), lib.crc32(new Int8Array(b.buffer, 0, b.length)), lib.adler([...b].reverse())); });

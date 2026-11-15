// An untyped package and a program of it (bit fields): a growable writer and a reader over typed arrays: integers, floats, varints, texts, bits, checksums, base 64 and hex
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
for (let i = 0; i < 20; i++) { const w = new lib.Writer(2).bits([[i, 5], [i & 1, 1], [i * 3 & 7, 3], [i * 1000, 14], [-1, i % 9]]); const b = w.done(); say(i, lib.hex(b), b.length, b.byteLength === w.at, new Uint16Array(b.slice(0, 2).buffer)[0], [...b].map(x => x.toString(2)).join()); } const mixed = new Uint8ClampedArray([300, -5, 1.5, 2.5, NaN]), f = new Float32Array([1.1, 2 ** 130, -0]); say([...mixed].join(), [...f].join(), Object.is(f[2], -0), lib.hex(new Uint8Array(f.buffer)), lib.crc32(mixed), f.at(-1), mixed.indexOf(255), [...new Uint8Array([1, 2, 3, 4, 5]).copyWithin(1, 3)].join(), [...new Int16Array([5, 1, -3]).sort()].join(), [...new BigUint64Array([1n, -1n])].join());

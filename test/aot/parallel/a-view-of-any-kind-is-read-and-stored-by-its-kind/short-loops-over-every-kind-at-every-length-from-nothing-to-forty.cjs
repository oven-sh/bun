"use strict";
// STATISTIC: LoopsLaidOutForEachKindOfView >= 3
// A short counted loop over what nobody has typed: behind the front, views of all kinds but bytes share one copy, and the eight turns that the code generator lays out in a row stand once for each kind, the kind asked in front.
// Every kind, at every length from 0 to 40 (no stretch of eight, one, several, with and without a rest), views that begin in the middle of their memory, the greatest and least of each kind, NaN of several bit patterns, -0.
var key = JSON.parse('"go"');
var sums = { go(d) { var s = 0; for (var i = 0; i < d.length; i++) s += d[i]; return s; } };
var bits = { go(d) { var h = 0; for (var i = 0; i < d.length; i++) h = (h ^ d[i]) + i | 0; return h; } };
var tops = { go(d) { var m = -Infinity; for (var i = 0; i < d.length; i++) if (d[i] > m) m = d[i]; return m; } };
var twos = { go(d) { var s = 0; for (var i = 0; i + 1 < d.length; i++) s += d[i] - d[i + 1] * 0.5; return s; } };
var down = { go(d) { var s = 0; for (var i = d.length - 1; i >= 0; i--) s = s * 0.5 + d[i]; return s; } };
var kinds = [Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8Array];
var odd = [0, -0, 1, -1, 127, 128, 255, 256, -128, -129, 32767, 32768, 65535, 65536, -32769, 2147483647, 2147483648, 4294967295, 4294967296, -2147483649, 0.5, -0.5, 1e21, -1e21, Infinity, -Infinity, NaN, 3.4e38, 1e-320];
var lines = [];
for (var kind of kinds) {
  var said = [kind.name];
  for (var length = 0; length <= 40; length++) {
    var memory = new ArrayBuffer((length + 3) * kind.BYTES_PER_ELEMENT), view = new kind(memory, kind.BYTES_PER_ELEMENT * (length & 3 ? 1 : 0), length);
    for (var i = 0; i < length; i++) view[i] = odd[(i * 7 + length) % odd.length];
    said.push([sums[key](view), bits[key](view), tops[key](view), twos[key](view), down[key](view)].map(x => Object.is(x, -0) ? "-0" : String(x)).join("/"));
  }
  lines.push(said.join(" "));
}
var words = new Uint32Array(24), floats = new Float32Array(words.buffer), pairs = new Float64Array(words.buffer);
for (var i = 0; i < 24; i++) words[i] = [0x7fc00000, 0xffc00001, 0x7f800001, 0xfff80000, 0x7ff00000, 0xffffffff, 0x3f800000, 1][i & 7];
lines.push("NaN of many patterns " + [sums[key](floats), tops[key](floats), bits[key](floats), sums[key](pairs), tops[key](pairs), bits[key](pairs), sums[key](words)].join(" "));
lines.push("strangers " + [sums[key]([1, 2.5, 3]), sums[key]("123456789"), sums[key]({ length: 9, 0: 1, 8: 2 }), sums[key](new BigInt64Array(0)), sums[key](Buffer.from("abcdefghijk")), tops[key](new (class extends Int16Array {})(12).fill(-7))].join(" "));
console.log(lines.join("\n"));

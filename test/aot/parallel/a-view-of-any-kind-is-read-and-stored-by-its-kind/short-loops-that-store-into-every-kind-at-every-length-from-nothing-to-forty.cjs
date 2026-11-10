"use strict";
// STATISTIC: LoopsLaidOutForEachKindOfView >= 3
// Under: --aot-testing=EmittersAloneTestEveryPosition: the turns are laid out as users build them, and every raw access asks its position at the run
// Short counted loops that store into what nobody has typed. The eight turns laid out in a row stand once for each kind of view, and in them a store is the store of that kind: it wraps, clamps or rounds as the kind does.
// A turn reads what the turn before it stored; a turn reads what a later turn will store; every kind, every length from 0 to 40, views that begin in the middle of their memory.
var key = JSON.parse('"go"');
var bump = { go(d) { for (var i = 0; i < d.length; i++) d[i] = d[i] + 1; return d.length; } };
var scale = { go(d) { for (var i = 0; i < d.length; i++) d[i] = d[i] * 1.5; return d.length; } };
var fill = { go(d) { for (var i = 0; i < d.length; i++) d[i] = i * 37.25 - 300; return d.length; } };
var runningSum = { go(d) { for (var i = 0; i + 1 < d.length; i++) d[i + 1] = d[i] + d[i + 1]; return d.length; } };
var shiftDown = { go(d) { for (var i = 0; i + 1 < d.length; i++) d[i] = d[i + 1]; return d.length; } };
var huge = { go(d) { for (var i = 0; i < d.length; i++) d[i] = d[i] * 1e9 + 0.5; return d.length; } };
var nothing = { go(d) { for (var i = 0; i < d.length; i++) d[i] = d[i] / 0 - d[i] / 0; return d.length; } };
var kinds = [Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8Array];
var odd = [0, -0, 1, -1, 127, 128, 255, 256, -128, -129, 32767, 32768, 65535, 65536, -32769, 2147483647, 2147483648, 4294967295, 4294967296, -2147483649, 0.5, -0.5, 1.5, 2.5, 254.5, 1e21, -1e21, Infinity, -Infinity, NaN];
function hash(view) { var h = 17; for (var i = 0; i < view.length; i++) { var x = view[i]; h = (h * 31 + (Object.is(x, -0) ? 7 : x !== x ? 11 : x % 65521)) % 1000003; } return h; }
var lines = [];
for (var kind of kinds) {
  for (var deed of [bump, scale, fill, runningSum, shiftDown, huge, nothing]) {
    var said = [];
    for (var length = 0; length <= 40; length++) {
      var memory = new ArrayBuffer((length + 3) * kind.BYTES_PER_ELEMENT), whole = new kind(memory), view = new kind(memory, kind.BYTES_PER_ELEMENT * (length & 3 ? 1 : 0), length);
      for (var i = 0; i < whole.length; i++) whole[i] = odd[(i * 7 + length) % odd.length];
      deed[key](view); said.push(hash(whole));
    }
    lines.push(kind.name + " " + said.join(" "));
  }
}
var list = [1, 2.5, 3, 4, 5, 6, 7, 8, 9, 10]; bump[key](list); scale[key](list); lines.push("a list " + list.join());
var record = { length: 9, 0: 1, 8: 2 }; bump[key](record); lines.push("a record " + JSON.stringify(record));
var heir = new (class extends Int16Array {})(12).fill(32767); bump[key](heir); lines.push("an heir " + heir.join());
console.log(lines.join("\n"));

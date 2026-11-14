"use strict";
// Short counted loops over TWO holders that nobody has typed. Where both are views of one kind the turns laid out for that kind take them; two kinds, a view and a list, texts, one holder shorter than the other, one memory under both: the loop as written.
// A sum of two elements says "numbers or texts": lists of texts must come out joined.
var key = JSON.parse('"go"');
var dot = { go(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; } };
var addTo = { go(a, b) { for (var i = 0; i < a.length; i++) a[i] = a[i] + b[i]; return a.length; } };
var into = { go(a, b) { for (var i = 0; i < a.length; i++) b[i] = a[i] * 2 - b[i]; return a.length; } };
var chase = { go(a, b) { for (var i = 0; i + 1 < a.length; i++) a[i + 1] = a[i] + b[i]; return a.length; } };
var kinds = [Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Uint8Array];
var odd = [0, -0, 1, -1, 127, 128, 255, 256, -129, 32767, 65535, 65536, 2147483647, 4294967295, 4294967296, 0.5, -0.5, 2.5, 1e21, Infinity, NaN];
function fill(view, from) { for (var i = 0; i < view.length; i++) view[i] = odd[(i * 5 + from) % odd.length]; return view; }
function hash(list) { var h = 17; for (var i = 0; i < list.length; i++) { var x = list[i]; h = (h * 31 + (typeof x === "string" ? x.length + 3 : Object.is(x, -0) ? 7 : x !== x ? 11 : x % 65521)) % 1000003; } return h; }
var lines = [];
for (var first of kinds) for (var second of [first, Float64Array, Int16Array]) {
  var said = [first.name + "," + second.name];
  for (var length of [0, 1, 3, 4, 5, 7, 8, 9, 12, 16, 19, 33]) {
    for (var deed of [dot, addTo, into, chase]) {
      var a = fill(new first(length), length), b = fill(new second(length), length + 3), r = deed[key](a, b);
      said.push(String(r) + ":" + hash(a) + ":" + hash(b));
    }
  }
  lines.push(said.join(" "));
}
for (var kind of kinds) {
  var memory = new ArrayBuffer(40 * kind.BYTES_PER_ELEMENT), low = fill(new kind(memory, 0, 30), 1), high = new kind(memory, 2 * kind.BYTES_PER_ELEMENT, 30);
  addTo[key](high, low); chase[key](low, high); into[key](low, low); lines.push("one memory " + kind.name + " " + hash(new kind(memory)) + " " + dot[key](low, low));
  var long = fill(new kind(21), 2), short = fill(new kind(9), 4); lines.push("one is shorter " + kind.name + " " + dot[key](long, short) + " " + addTo[key](long, short) + " " + hash(long) + " " + into[key](long, short) + " " + hash(short));
}
var texts = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], more = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]; addTo[key](texts, more); lines.push("texts " + texts.join());
var mixed = [1, "b", 2.5, null, undefined, true, 7, 8, 9, 10], numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; addTo[key](mixed, numbers); lines.push("mixed " + mixed.join());
var plain = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10.5]; addTo[key](plain, new Float32Array(10).fill(0.5)); lines.push("a list and a view " + plain.join() + " " + dot[key](new Int8Array(10).fill(3), plain));
console.log(lines.join("\n"));

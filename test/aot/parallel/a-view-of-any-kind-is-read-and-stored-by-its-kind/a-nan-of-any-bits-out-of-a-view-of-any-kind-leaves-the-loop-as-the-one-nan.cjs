"use strict";
// Floats whose bytes spell a NaN of other bits than the one that a value may hold: among them the patterns that, boxed as they are, would read as an integer, a cell or nothing at all.
// Read off a view of any kind in a short loop, such a number may stay as it is while operators on numbers alone take it. Wherever it leaves them (it is returned, kept in a field, a list, a variable of the module, handed to a function,
// joined to a text, asked what it is) it is the one NaN.
var key = JSON.parse('"go"');
var outside = 0;
var last = { go(d) { var x = 0; for (var i = 0; i < d.length; i++) x = d[i]; return x; } };
var timesOne = { go(d) { var x = 0; for (var i = 0; i < d.length; i++) x = d[i] * 1; return x; } };
var sum = { go(d) { var s = 0; for (var i = 0; i < d.length; i++) s += d[i]; return s; } };
var notBelow = { go(d) { var m = 0; for (var i = 0; i < d.length; i++) if (!(d[i] <= m)) m = d[i]; return m; } };
var howMany = { go(d) { var n = 0; for (var i = 0; i < d.length; i++) if (d[i] !== d[i]) n++; return n; } };
var inField = { go(d) { var o = { v: 0 }; for (var i = 0; i < d.length; i++) o.v = d[i] - 0; return o; } };
var inList = { go(d) { var o = [0, 0]; for (var i = 0; i < d.length; i++) o[i & 1] = d[i] + 0; return o; } };
var inVariable = { go(d) { for (var i = 0; i < d.length; i++) outside = d[i] / 1; return outside; } };
var pushed = { go(d) { var o = []; for (var i = 0; i < d.length; i++) o.push(d[i] * 1); return o; } };
var bits = { go(d) { var h = 0; for (var i = 0; i < d.length; i++) h = (h * 31 + (d[i] | 0)) | 0; return h; } };
var heldByClosure = { go(d) { var s = 0; var read = function () { return s; }; for (var i = 0; i < d.length; i++) s += d[i]; return read(); } };
var lastHeldByClosure = { go(d) { var x = 0; var read = function () { return x; }; for (var i = 0; i < d.length; i++) x = d[i] * 1; return read(); } };
function say(x) { return typeof x === "object" ? JSON.stringify(x) + (Array.isArray(x) ? x.map(say).join() : say(x.v)) : typeof x + ":" + String(x) + ":" + Object.is(x, NaN) + ":" + (x === x); }
var high = [0x7ff80000, 0xfff80000, 0x7ff00000, 0xfff00000, 0xfffe0000, 0xffff0000, 0xfffc0000, 0x7fff0000, 0x7ffe0000, 0xfffa0000, 0xfff90000, 0x7ff7ffff, 0xffffffff, 0x7fffffff, 0x3ff00000];
var low = [0, 1, 2, 6, 7, 10, 0xffffffff, 0x80000000];
var lines = [];
for (var length of [1, 3, 4, 5, 8, 9, 13]) for (var h of high) for (var l of low) {
  var words = new Uint32Array(length * 2); for (var i = 0; i < length; i++) { words[i * 2] = l; words[i * 2 + 1] = h; }
  var doubles = new Float64Array(words.buffer), floats = new Float32Array(words.buffer);
  var said = [];
  for (var deed of [last, timesOne, sum, notBelow, howMany, inField, inList, inVariable, pushed, bits, heldByClosure, lastHeldByClosure]) said.push(say(deed[key](doubles)), say(deed[key](floats)));
  lines.push(said.join(" "));
}
var seen = new Map(); for (var line of lines) seen.set(line, (seen.get(line) || 0) + 1);
for (var [line, times] of seen) console.log(times + " x " + line);

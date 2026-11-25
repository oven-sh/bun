"use strict";
var key = JSON.parse('"go"');
var high = [0xfffe0000, 0xffff0000, 0xfffc0000, 0x7fff0000, 0xfff80000, 0x7ff80000, 0xffffffff];
var low = [0, 1, 2, 6, 7, 10];
var lengths = [1, 3, 4, 5, 9, 17];
var kept = [], floats = [], bad = 0, asked = 0;
function each(deed) {
  for (var length of lengths) for (var h of high) for (var l of low) {
    var words = new Uint32Array(length * 2);
    for (var i = 0; i < length; i++) { words[i * 2] = l; words[i * 2 + 1] = h; }
    var three = [new Float64Array(words.buffer), new Float32Array(words.buffer), new Int32Array(words.buffer)];
    for (var k = 0; k < 3; k++) { asked++; floats.push(k < 2); deed(three[k], Math.max(1, (three[k].length - 1) >> (asked & 1))); }
  }
}
function say() {
  Bun.gc(true);
  for (var k = 0; k < kept.length; k++) { var x = kept[k]; if (typeof x !== "number" || (x !== x) !== floats[k] || (floats[k] && !Object.is(x, NaN))) bad++; }
  Bun.gc(true);
  console.log("SAID " + [bad, asked, kept.length].join(" "));
}

var way = { go(d) { var s = 0; for (var i = 0; i < d.length; i++) s += d[i]; return s; } };
each(function (view) { kept.push(way[key](view)); });
say();

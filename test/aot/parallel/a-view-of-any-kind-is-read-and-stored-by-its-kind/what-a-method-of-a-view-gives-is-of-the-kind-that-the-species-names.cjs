"use strict";
// What filter, map and slice of a view give is made by whatever the species names. The loops over the result are built for bytes and for the other views; what comes may be of another kind than the receiver, or no view at all.
var print = console.log;
const bytes = new Uint8Array([1, 2, 3, 255, 9, 11, 13, 15, 17]), shorts = new Int16Array([-1, -2, 7, 9, 11, -13, 15]), doubles = new Float64Array([1, 2.5, 3, NaN, 4.5, 6.5]);
class Wide extends Uint8Array { static get [Symbol.species]() { return Float64Array; } }
class Narrow extends Float64Array { static get [Symbol.species]() { return Int8Array; } }
const wide = new Wide([1, 2, 3, 255, 9, 11]), narrow = new Narrow([1.5, 300.5, -3.5, 5, 7, 9]);
function total(p) { var s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = s + p[i]; return s + ":" + p.constructor.name + ":" + p.length; }
function ofBytes() { var p = bytes.filter(x => x & 1), s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = (s + p[i]) | 0; return s + ":" + p.constructor.name; }
function ofShorts() { var p = shorts.map(x => x * 3), s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = (s + p[i]) | 0; return s + ":" + p.constructor.name; }
function ofDoubles() { var p = doubles.slice(1), s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = s + p[i]; return s + ":" + p.constructor.name; }
function ofWide() { var p = wide.filter(x => x & 1), s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = s + p[i] * 0.5; return s + ":" + p.constructor.name; }
function ofNarrow() { var p = narrow.map(x => x * 2), s = 0; for (var r = 0; r < 2; r++) for (var i = 0; i < p.length; i++) s = (s + p[i]) | 0; return s + ":" + p.constructor.name; }
print(ofBytes(), ofShorts(), ofDoubles(), ofWide(), ofNarrow(), total(bytes.filter(x => x > 250)), total(wide.slice(2)), total(narrow.filter(x => x > 0)));

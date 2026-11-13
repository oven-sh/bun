// Reads of lists with holes in loops: under keys that may lie below zero, tested at the head of an inner loop, and integers or null in arithmetic.
function Entry(key) { this.key = key; this.value = key * 2; this.next = null; }
function told(v) { return v === undefined ? "u" : v === null ? "n" : Object.is(v, -0) ? "-0" : v instanceof Entry ? "e" + v.key : typeof v + v; }
function fill(list, count, mask) { for (var i = 0; i < count; i++) { var e = new Entry((i * 2654435761) | 0); e.next = list[e.key & mask]; list[e.key & mask] = e; } return list; }
function move(list, length) { var moved = new Array(length); for (var i = 0; i < list.length; ++i) { var e = list[i]; list[i] = null; while (e) { var index = e.key & (length - 1), next = e.next; e.next = moved[index]; moved[index] = e; e = next; } } return moved; }
function moveToAnyKey(list, length, shift) { var moved = new Array(length); for (var i = 0; i < list.length; ++i) { var e = list[i]; while (e) { var index = (e.key & (length - 1)) - shift, next = e.next; e.next = moved[index]; moved[index] = e; e = next; } } return moved; }
function count(list, mask) { var n = 0, s = 0; for (var k = -20; k < 400; k++) { var e = list[k & mask]; while (e && e.key !== k) { e = e.next; s++; } if (e) n++; } return n + " " + s; }
function below(list) { var s = ""; for (var k = -3; k < 6; k++) s += told(list[k]) + ","; return s; }
function belowInLoop(list) { var s = 0; for (var k = -3; k < 12; k++) for (var e = list[k]; e; e = e.next) s = (s * 31 + e.key) | 0; return s; }
function shape(list) { var out = []; for (var i = 0; i < list.length; i++) { var n = 0; for (var e = list[i]; e; e = e.next) n++; out.push(i in list ? n : "hole"); } return out.join(); }
var a = fill(new Array(8), 40, 7), b = move(fill(new Array(8), 40, 7), 64), c = moveToAnyKey(fill(new Array(8), 40, 7), 16, 2);
console.log(shape(a), shape(b), shape(c), told(c[-1]), told(c[-2]), Object.keys(c).length);
console.log(count(a, 7), count(b, 63), below(a), below(b), below(c), belowInLoop(a), belowInLoop(b), belowInLoop(c));
var named = [1, , 3]; named[-1] = "name"; named[1.5] = "half"; var past = [new Entry(1), , new Entry(3)]; past[-2] = new Entry(9);
console.log(below(named), below(past), belowInLoop(past), below([1.5, , 2.5]), below([, , ]), below([]), below(Object.freeze([, 2])), below(new (class extends Array {})(4)));
var bare = [1, , 3]; Object.setPrototypeOf(bare, { 1: "below" }); console.log(below(bare));
var asked = [new Entry(1), , new Entry(3)]; Object.defineProperty(asked, 1, { get: function () { return new Entry(5); }, configurable: true }); console.log(below(asked), belowInLoop(asked));

function value(o, i) { if (i % 3 === 0) return null; return o.value; }
function nullOrInteger(list) { var s = 0, p = 1, d = 0.5, m = -5, t = 0, c = 0, f = []; for (var i = 0; i < 24; i++) { var q = value(list[i % list.length], i); s += q; p = (p * (q + 1)) % 1000003; d += q * 0.5; m = Math.max(m, q); t = (t + q) | 0; c += q === null ? 1 : 0; f.push(q - 1, -q, 1 / q, q % 4, q ** 2, +q); } return [s, p, d, m, t, c].map(told).join() + f.map(told).join(); }
function nothingOrInteger(list) { var s = 0, t = 0; for (var i = 0; i < 12; i++) { var q = i % 5 === 4 ? undefined : value(list[i % list.length], i); s += q; t = (t + q) | 0; } return told(s) + told(t); }
var boxes = function (values) { return values.map(function (v) { var e = new Entry(1); e.value = v; return e; }); };
for (var values of [[1, 2, 3], [0, -1, 5], [2147483647, -2147483648, 7], [null, 4, 9], [4294967296, 1, 2], [1.5, 2, 3], [-0, 1, 2], [undefined, 1, 2], [NaN, 3, 4]]) console.log(nullOrInteger(boxes(values)), nothingOrInteger(boxes(values)));

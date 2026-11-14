// A called function and the turns of a loop clear a view of a buffer between accesses through the other views of it.
var heap, words, numbers, out = [];
function make(n) { heap = new ArrayBuffer(n); words = new Int32Array(heap); numbers = new Uint32Array(heap); }
function clear(n) { var x = n | 0, y = 1; for (var i = 0; i < 4; i++) { x = (x * 3 + i) | 0; if (x & 1) y = (y + x) | 0; else y = (y ^ x) | 0; for (var j = 0; j < 3; j++) { y = (y + j * x) | 0; if (y & 2) { x = (x + y) | 0; } else { x = (x - y) | 0; } } if (y & 4) { x = x ^ 9; } if (x & 8) { y = (y - 3) | 0; } } if (n < 2) numbers = undefined; return (x ^ y) & 7; }
function behind(p) { var a = words[p], b = numbers[p], k = clear(p), c = words[p], d = numbers[p]; return [a, b, c, d]; }
function neighbors(p) { var a = words[p] + words[p + 1], k = clear(p), c = words[p] + words[p + 1], d = numbers[p] + numbers[p + 1]; return [a, c, d]; }
function stored(p) { var a = words[p], k = clear(p), c = words[p]; numbers[p] = 77; return [a, c, words[p]]; }
function hoisted(p) { var s = 0; for (var i = 0; i < 3; i++) { clear(p); s = (s * 3 + words[p]) | 0; s = (s + numbers[p]) | 0; } return [s]; }
function hoistedStore(p) { var s = 0; for (var i = 0; i < 3; i++) { clear(p); s = (s + words[p]) | 0; numbers[p] = i; } return [s, words[p]]; }
function late(p) { var s = 0; for (var i = 0; i < 4; i++) { if (i == 2) clear(p); s = (s * 5 + words[p]) | 0; s = (s + numbers[p]) | 0; } return [s]; }
function nested(p) { var s = 0; for (var i = 0; i < 3; i++) { if (i == 1) clear(p); for (var j = 0; j < 3; j++) { s = (s + words[p]) | 0; s = (s ^ numbers[p]) | 0; } } return [s]; }
for (var r = 0; r < 2; r++) for (var f of [behind, neighbors, stored, hoisted, hoistedStore, late, nested]) for (var p of [0, 1, 2, 5, 7, 8, -1]) { make(32); for (var i = 0; i < 8; i++) words[i] = i * 1000 + 5; try { out.push(f.name + p + ":" + f(p).join()); } catch (e) { out.push(f.name + p + e.name); } out.push(Array.prototype.join.call(words)); }
console.log(out.join("\n"));

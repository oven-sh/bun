// A view of a buffer is cleared or replaced between two accesses through the other views of it.
var heap, words, numbers, out = [];
function make(n) { heap = new ArrayBuffer(n); words = new Int32Array(heap); numbers = new Float32Array(heap); }
function small(n) { var x = n | 0, y = 1; for (var i = 0; i < 4; i++) { x = (x * 3 + i) | 0; if (x & 1) y = (y + x) | 0; else y = (y ^ x) | 0; for (var j = 0; j < 3; j++) { y = (y + j * x) | 0; if (y & 2) { x = (x + y) | 0; } else { x = (x - y) | 0; } } if (y & 4) { x = x ^ 9; } if (x & 8) { y = (y - 3) | 0; } } numbers = undefined; return (x ^ y) & 7; }
function between(p) { var a = words[p], b = numbers[p], k = small(p), c = words[p], d = 0; try { d = numbers[p]; } catch (e) { d = e.name; } words[p] = 3; return [a, b, c, d, k, words[p]]; }
function inline(p) { var a = words[p], b = numbers[p]; numbers = undefined; var c = words[p], d = words[p + 1]; try { numbers[p] = 4; } catch (e) { d = e.name; } return [a, b, c, d]; }
function loop(p) { var s = ""; for (var i = 0; i < 3; i++) { s += words[p] + "/"; if (i == 1) numbers = undefined; s += words[p + 1] + "/"; try { s += numbers[p] + ";"; } catch (e) { s += e.name; } } return s; }
function other(p) { var a = words[p] + words[p + 1]; heap = new ArrayBuffer(8); numbers = new Float32Array(heap); var b = words[p] + words[p + 1]; return [a, b, numbers[p], numbers[p + 1], numbers[p + 2]]; }
for (var r = 0; r < 2; r++) for (var p of [0, 1, 2, 3, 6, 7, 8, -1]) { make(32); for (var i = 0; i < 8; i++) words[i] = i * 1000; out.push(between(p).join()); make(32); out.push(inline(p).join()); make(32); out.push(loop(p)); make(32); out.push(other(p).join()); }
console.log(out.join("\n"));

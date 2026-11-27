// Two variables that hold views are swapped by calls and by stores between accesses.
var a = new Int32Array([1, 2, 3, 4]), b = new Int32Array([50, 60, 70]), t, total = 0, out = [];
function swap(n) { var x = n | 0, y = 1, z = 7; for (var i = 0; i < 4; i++) { x = (x * 3 + i) | 0; if (x & 1) y = (y + x) | 0; else z = (z ^ x) | 0; for (var j = 0; j < 3; j++) { z = (z + j * y) | 0; y = (y << 1) ^ z; if (z & 2) { x = (x + y) | 0; } else { x = (x - z) | 0; } } if (y & 4) { z = (z + 5) | 0; x = x ^ 9; } if (x & 8) { y = (y - 3) | 0; z = z ^ 3; } } t = a; a = b; b = t; return (x ^ y ^ z) & 7; }
function read(p) { var x = a[p]; var k = swap(3); var y = a[p]; return [x, y, k]; }
function twice(p) { var x = a[p] + a[p + 1]; swap(5); var y = a[p] + a[p + 1]; swap(2); return [x, y, a[p]]; }
function loop(p) { var s = 0; for (var i = 0; i < 4; i++) { s = s * 10 + a[p]; swap(i); s = s + a[p]; } return s; }
function write(p, v) { a[p] = v; swap(6); a[p] = v + 1; return a[p] + "," + b[p]; }
function both(p) { var x = a[p], y = b[p]; swap(4); return [x, y, a[p], b[p], a[p + 1], b[p + 1]]; }
for (var k = 0; k < 3; k++) for (var p = 0; p < 4; p++) { out.push(read(p).join(), twice(p).join(), loop(p), write(p, k * 10), both(p).join()); }
console.log(out.join("\n"));

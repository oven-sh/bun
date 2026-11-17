function two(d: number): number { let a = d, b = 1; function f() { a += b; b++; } f(); if (d) a += two(d - 1); f(); return a + b; }
function four(d: number): number { let a = d, b = 1, c = 2, e = 3; function f() { a += b; b += c; c += e; e++; } f(); if (d) a += four(d - 1); f(); return a + b + c + e; }
function five(d: number): number { let a = d, b = 1, c = 2, e = 3, g = "x"; function f() { a += b; b += c; c += e; e++; g += a; } f(); if (d) a += five(d - 1); f(); return a + b + c + e + g.length; }
let s = 0; for (let i = 0; i < 40; i++) s += two(i % 11) + four(i % 7) + five(i % 9);
console.log(s);

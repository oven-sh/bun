function twice(x: number, n: number): string { for (let i = 0; i < n; i++) x = (x * 2) % 4; return Object.is(x, -0) ? "-0" : String(x); }
function falls(n: number, by: number): string { let x = 7, t = 0; for (let i = 0; i < n; i++) { x = (x * 3 - by) % 5; t += x; } return x + " " + t + " " + Object.is(x, -0); }
console.log(twice(-2, 1), twice(2, 1), twice(-0, 3), twice(-3, 1), twice(3, 2), "|", falls(5, 20), falls(1, 26), falls(2, 16));

function rotate(n: number): string { let a = 0, b = 1; for (let i = 0; i < n; i++) { const t = (a + b) % 1000; a = b; b = t; } return a + " " + b; }
function nest(n: number, m: number): number { let x = 1; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) x = (x * 7 + j + 1) % 50; return x; }
console.log(rotate(30), nest(3, 2), nest(0, 9), nest(1, 3));

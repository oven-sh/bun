function literal(n: number): number { let x = 134217729; for (let i = 0; i < n; i++) x = (x * x) % 1000; return x; }
function square(x: number, n: number): number { for (let i = 0; i < n; i++) x = (x * x) % 1000; return x; }
function large(n: number): number { let x = 1; for (let i = 0; i < n; i++) x = (x * 94906267 + 3) % 94906267; return x; }
console.log(literal(1), literal(2), square(94906265, 1), square(94906266, 1), square(134217729, 1), square(1.5, 1), large(2));

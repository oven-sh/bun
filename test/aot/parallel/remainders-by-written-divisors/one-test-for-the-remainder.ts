function step9(x: number, n: number): number { x = x % 10; for (let i = 0; i < n; i++) x = (x + 9) % 10; return x; }
function step11(x: number, n: number): number { x = x % 10; for (let i = 0; i < n; i++) x = (x + 11) % 10; return x; }
function wide(n: number): number { let x = 1; for (let i = 0; i < n; i++) x = (x + 4294967294) % 4294967295; return x; }
console.log(step9(0, 4), step9(1, 1), step9(9, 1), step11(9, 1), step11(3, 3), wide(1), wide(2), wide(3));

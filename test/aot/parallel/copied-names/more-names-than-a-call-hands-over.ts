function outer(): number { const a = 1, b = 2, c = 3, d = 4, e = 5, f = 6; return sum(); function sum(): number { return a + b + c + d + e + f; } }
console.log(outer());

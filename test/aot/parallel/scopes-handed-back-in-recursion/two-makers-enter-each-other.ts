function even(n: number): number { let seen = 0; function note(x: number) { seen += x; } note(n); if (n) note(odd(n - 1)); return seen; }
function odd(n: number): number { let seen = 1; let twice = 0; function note(x: number) { seen += x; twice += 2 * x; } note(n); if (n) note(even(n - 1)); return seen + twice; }
let sum = 0;
for (let i = 0; i < 60; i++) sum = (sum + even(i % 14)) % 1000003;
console.log(sum);

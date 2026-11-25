function apply(x: number, f: (x: number) => number): number { return f(x); }
function inner(x: number, k: number): number { return apply(x, y => y * k); }
function outer(x: number, k: number): number { return apply(x, y => inner(y, k + 1)); }
function outermost(x: number, k: number): number { return apply(x, y => outer(y + 1, k)); }
let sum = 0;
for (let i = 0; i < 400; i++) sum += outermost(i, i & 7);
console.log(sum);

function second(x: number, visit: (x: number) => number): number { return visit(x + 1); }
function first(x: number, visit: (x: number) => number): number { return second(x * 2, visit); }
function start(k: number): number { return first(k, x => x * k); }
function other(k: number): number { return first(k, x => x - k); }
let sum = 0;
for (let i = 0; i < 500; i++) sum += start(i) + other(i);
console.log(sum);

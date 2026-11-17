function call(f: (x: number) => number, x: number): number { return f(x); }
function through(f: (x: number) => number, x: number): number { return call(f, x + 1); }
function start(k: number): number { return through(x => x * k, k); }
let sum = 0;
for (let i = 0; i < 500; i++) sum += start(i);
console.log(sum);

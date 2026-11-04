class Blocks { static n = 1; static { for (let i = 0; i < 4; i++) Blocks.n += i; } static m = Blocks.n * 2; }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Blocks.n + Blocks.m; return t; }
console.log(run(3));
export {};

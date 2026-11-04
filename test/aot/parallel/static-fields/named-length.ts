class Long { static length = 7; constructor(a: number, b: number) {} }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Long.length; return t; }
console.log(run(2)); (Long as any).length = 9; console.log(run(2));
export {};

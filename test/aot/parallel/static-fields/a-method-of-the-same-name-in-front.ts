// @ts-expect-error
class Both { static raw() { return 1; } static raw = 5 as any; }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Both.raw as any; return t; }
console.log(run(3), typeof Both.raw);
export {};

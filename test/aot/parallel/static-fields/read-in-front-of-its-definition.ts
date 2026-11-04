class Early { static first = (() => { let t = 0; for (let i = 0; i < 3; i++) t += (Early as any).second === undefined ? 1 : 100; return t; })(); static second = 2; }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Early.first + Early.second; return t; }
console.log(run(3));
export {};

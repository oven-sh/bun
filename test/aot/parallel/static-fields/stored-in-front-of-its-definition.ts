class Early { static first = (() => { for (let i = 0; i < 3; i++) (Early as any).second = i; return (Early as any).second; })(); static second = 20; }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Early.first + Early.second; return t; }
console.log(run(3), Object.keys(Early).join());
export {};

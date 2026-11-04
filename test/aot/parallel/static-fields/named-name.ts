class Named { static name = "mine"; }
function run(times: number) { let t = ""; for (let i = 0; i < times; i++) t += Named.name; return t; }
console.log(run(2)); (Named as any).name = "other"; console.log(run(2), Object.getOwnPropertyDescriptor(Named, "name")!.writable);
export {};

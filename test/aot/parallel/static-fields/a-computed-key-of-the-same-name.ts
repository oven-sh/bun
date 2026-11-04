const k = ["r", "aw"].join("");
class Keyed { static raw = 1; static [k] = 2; }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) t += Keyed.raw; return t; }
console.log(run(3), Object.keys(Keyed).join());
export {};

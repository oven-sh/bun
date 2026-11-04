class Meter { static raw = 1; }
function read(depth: number): number { return depth > 0 ? read(depth - 1) : Meter.raw; }
function run(times: number) { let total = 0; for (let i = 0; i < times; i++) { Meter.raw = i * 3; total += read(i & 1); } return total; }
console.log(run(6), Meter.raw);
export {};

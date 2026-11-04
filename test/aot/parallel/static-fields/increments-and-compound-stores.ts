class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function run(times: number) { for (let i = 0; i < times; i++) { Meter.raw++; Meter.raw += 2; Meter.raw *= 2; --Meter.raw; } return Meter.raw; }
console.log(run(5));
export {};

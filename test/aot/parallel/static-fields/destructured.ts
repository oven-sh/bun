class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function run(times: number) { let t = 0; for (let i = 0; i < times; i++) { const { raw, label } = Meter; t += raw + label.length; Meter.raw = t; } return t; }
console.log(run(4));
export {};

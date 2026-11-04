class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
class Below extends Meter { static raw = 50; }
function run(times: number) { let total = 0; for (let i = 0; i < times; i++) { Below.raw++; total += Below.raw + Meter.raw; } return total; }
console.log(run(4), Meter.raw, Below.raw);
export {};

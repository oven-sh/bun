class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
class Below extends Meter { static own = 5; }
function run(times: number) { let total = 0; for (let i = 0; i < times; i++) total += Below.raw + Below.own; return total; }
console.log(run(4)); Meter.raw = 8; console.log(run(4));
export {};

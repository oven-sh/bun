class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function run(times: number) { let total = 0; for (let i = 0; i < times; i++) { if (i === 3) Object.defineProperty(Meter, "raw", { get() { return 100; }, set(v) {}, configurable: true }); Meter.raw = i; total += Meter.raw; } return total; }
console.log(run(6));
export {};

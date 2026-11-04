class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function run(times: number) { let seen = 0; for (let i = 0; i < times; i++) { (Meter as any).raw = i & 1 ? undefined : i; if (Meter.raw === undefined) seen++; } return seen; }
console.log(run(6), Meter.raw, "raw" in Meter);
export {};

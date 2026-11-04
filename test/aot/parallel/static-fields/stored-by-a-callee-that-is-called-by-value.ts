class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
const bumps = [() => { Meter.raw += 2; }, () => { (Meter as any)["raw"] += 3; }];
function pair(times: number) { let d = 0; for (let i = 0; i < times; i++) { const a = Meter.raw; bumps[i & 1](); const b = Meter.raw; d += b - a; } return d; }
console.log(pair(6), Meter.raw);
export {};

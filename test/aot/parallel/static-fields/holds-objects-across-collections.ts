class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function churn(times: number) { let kept = 0; for (let i = 0; i < times; i++) { Meter.list = [i, i + 1]; if ((i & 1023) === 0) Bun.gc(true); kept += Meter.list[1]; } return kept; }
console.log(churn(5000), Meter.list.join());
export {};

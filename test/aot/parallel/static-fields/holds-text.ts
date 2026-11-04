class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function grow(times: number) { for (let i = 0; i < times; i++) Meter.label = Meter.label + i; return Meter.label; }
console.log(grow(5), Meter.label.length);
export {};

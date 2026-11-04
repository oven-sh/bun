class Meter { static raw = 1; }
function change(depth: number, to: number): void { if (depth > 0) change(depth - 1, to); else Object.defineProperty(Meter, "raw", { value: to, writable: true, enumerable: true, configurable: true }); }
function run(times: number) { let total = 0; for (let i = 0; i < times; i++) { const a = Meter.raw; change(i & 1, a + 4); total += Meter.raw - a; } return total; }
console.log(run(6), Meter.raw);
export {};

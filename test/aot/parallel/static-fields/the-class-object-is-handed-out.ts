class Meter { static raw = 1; static label = "m"; static list: number[] = []; static size() { return 2; } }
function sum(times: number) { let total = 0; for (let i = 0; i < times; i++) total += Meter.raw; return total; }
function fill(times: number) { for (let i = 0; i < times; i++) Meter.raw = i; return Meter.raw; }
function both(times: number) { let total = 0; for (let i = 0; i < times; i++) { Meter.raw = i & 7; total += Meter.raw; } return total; }
function show(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw, Object.getOwnPropertyDescriptor(Meter, "raw") === undefined ? "none" : JSON.stringify(Object.getOwnPropertyDescriptor(Meter, "raw"))); }
function quiet(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw); }
quiet("first"); (globalThis as any).Handed = Meter; (0, eval)("Handed.raw = 33"); console.log(sum(3)); (0, eval)("Object.defineProperty(Handed, 'raw', { get() { return 4; }, set(v) {} })"); quiet("behind");
export {};

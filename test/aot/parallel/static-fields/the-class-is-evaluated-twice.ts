function sum(times: number) { let total = 0; for (let i = 0; i < times; i++) total += Meter.raw; return total; }
function fill(times: number) { for (let i = 0; i < times; i++) Meter.raw = i; return Meter.raw; }
function both(times: number) { let total = 0; for (let i = 0; i < times; i++) { Meter.raw = i & 7; total += Meter.raw; } return total; }
function show(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw, Object.getOwnPropertyDescriptor(Meter, "raw") === undefined ? "none" : JSON.stringify(Object.getOwnPropertyDescriptor(Meter, "raw"))); }
function quiet(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw); }
function make(start: number) { return class Made { static raw = start; static sum(times: number) { let t = 0; for (let i = 0; i < times; i++) { Made.raw++; t += Made.raw; } return t; } }; }
const A = make(1), B = make(100);
console.log(A.sum(3), B.sum(3), A.raw, B.raw);
export {};

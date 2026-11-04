function sum(times: number) { let total = 0; for (let i = 0; i < times; i++) total += Meter.raw; return total; }
function fill(times: number) { for (let i = 0; i < times; i++) Meter.raw = i; return Meter.raw; }
function both(times: number) { let total = 0; for (let i = 0; i < times; i++) { Meter.raw = i & 7; total += Meter.raw; } return total; }
function show(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw, Object.getOwnPropertyDescriptor(Meter, "raw") === undefined ? "none" : JSON.stringify(Object.getOwnPropertyDescriptor(Meter, "raw"))); }
function quiet(step: string) { console.log(step, sum(3), fill(4), both(5), Meter.raw); }
class Mixed { static #hidden = 3; static shown = 4; static sum(times: number) { let t = 0; for (let i = 0; i < times; i++) { Mixed.#hidden++; Mixed.shown++; t += Mixed.#hidden + Mixed.shown; } return t; } }
console.log(Mixed.sum(4), Object.keys(Mixed).join());
export {};

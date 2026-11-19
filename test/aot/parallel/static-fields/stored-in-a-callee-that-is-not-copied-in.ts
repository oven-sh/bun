class Meter { static raw = 1; }
// It names itself, so no copy of it stands in the loop: the loop knows of it what Link says of its effects.
function bump(depth: number): void { if (depth > 0) bump(depth - 1); else Meter.raw++; }
function pair(times: number) { let d = 0; for (let i = 0; i < times; i++) { const a = Meter.raw; bump(i & 1); const b = Meter.raw; d += b - a; } return d; }
function sum(times: number) { let total = 0; for (let i = 0; i < times; i++) { total += Meter.raw; bump(0); } return total; }
console.log(pair(6), Meter.raw, sum(4), Meter.raw);
export {};

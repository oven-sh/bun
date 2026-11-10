// STATISTIC: TurnsOfForOfWrittenOutByNotedLength >= 1
function run(n: number): string { const l = [1, 2]; let s = 0, t = 0; for (let i = 0; i < n; i++) for (const k of l) { s++; t += k; } return s + " " + t; }
console.log(run(0), run(1), run(1000));

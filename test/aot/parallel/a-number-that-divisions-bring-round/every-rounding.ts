function run(round: number, n: number): string { let x = 1000, t = ""; for (let i = 0; i < n; i++) { if (round === 0) x = Math.floor(x / 3); else if (round === 1) x = Math.ceil(x / 3); else if (round === 2) x = Math.round(x / 3); else x = Math.trunc(x / -3); t += Object.is(x, -0) ? "-0," : x + ","; } return t; }
function ceilOfOne(n: number): number { let x = 1, turns = 0; while (x > 0 && turns < n) { x = Math.ceil(x / 2); turns++; } return x * 10 + turns; }
function wide(n: number): string { let x = 4000000000, t = ""; for (let i = 0; i < n; i++) { x = (x / 2) | 0; t += x + ","; } return t; }
console.log(run(0, 4), run(1, 4), run(2, 4), run(3, 4), ceilOfOne(3), wide(2));

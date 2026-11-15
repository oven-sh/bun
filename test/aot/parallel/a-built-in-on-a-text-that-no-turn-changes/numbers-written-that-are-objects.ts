let asked = 0;
const from: any = { valueOf() { return ++asked & 1; } };
function run(turns: number, q: string, a: number, b: number): string { let s = ""; for (let i = 0; i < turns; i++) s += q.slice(a, b) + q.substring(a, b) + q.substr(a, b) + ","; return s; }
(globalThis as any).kept = run;
console.log(run(3, "AbCdEf", 1, 4), run(3, "AbCdEf", from, 4), run(2, "AbCdEf", 1, from), run(2, "AbCdEf", NaN, -1), run(1, "AbCdEf", 1.7, Infinity), asked);

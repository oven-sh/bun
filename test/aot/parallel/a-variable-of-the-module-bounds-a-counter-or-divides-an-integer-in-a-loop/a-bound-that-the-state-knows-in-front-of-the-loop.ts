let bound = 0;
function run(n: number): number { if (n > 100) bound = n / 3; bound = 12; let s = 0; for (let i = 0; i < bound; i++) s += i & 7; return s; }
console.log(run(Number(process.argv[2] ?? "7")), bound);

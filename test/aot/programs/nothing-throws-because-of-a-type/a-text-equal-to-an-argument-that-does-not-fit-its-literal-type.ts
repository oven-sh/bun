type Runner = { run(): number };
const table: Record<string, Runner> = { zzz: { run() { return 9; } }, a: { run() { return 1; } } };
function pick(which: boolean, k: "a" | "b") { const x = which ? "zzz" : "a"; if (x === k) return table[x].run(); return -1; }
console.log(pick(true, "zzz" as any), pick(false, "a"), pick(true, "b"));

type Runner = { run(): number };
function pick(o: Record<string, Runner>, x: string, k: "a") { if (x === k) return 0; return o[x].run(); }
console.log(pick({ a: { run() { return 1; } }, b: { run() { return 2; } } }, "a", "b" as any));

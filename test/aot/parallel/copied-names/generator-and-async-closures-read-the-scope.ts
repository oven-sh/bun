function outer(base: number) { const a = base, b = base * 2; let seen = 0; return { *steps() { seen++; yield a; yield b + seen; }, async later() { seen++; await null; return a + b + seen; } }; }
const o = outer(5); console.log([...o.steps()].join()); o.later().then(console.log);

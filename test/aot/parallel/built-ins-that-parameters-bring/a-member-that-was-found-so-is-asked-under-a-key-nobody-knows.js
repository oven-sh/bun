function use(x, k) { const b = x.Bun; return typeof b[k]; }
console.log(`${use(globalThis, JSON.parse('"plugin"'))}`);

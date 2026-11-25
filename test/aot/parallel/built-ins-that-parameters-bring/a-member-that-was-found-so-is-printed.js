function use(x, k) { return Bun.inspect(x.console).length > 20; }
console.log(`${use(globalThis, JSON.parse('""'))}`);
// plain: true

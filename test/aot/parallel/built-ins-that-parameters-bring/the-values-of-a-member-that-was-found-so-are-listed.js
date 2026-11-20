function use(x, k) { return Object.values(x.console).length > 10; }
console.log(`${use(globalThis, JSON.parse('""'))}`);
// plain: true

function use(x, k) { x.process.stdout.write("written\\n"); return 1; }
console.log(`${use(globalThis, JSON.parse('""'))}`);

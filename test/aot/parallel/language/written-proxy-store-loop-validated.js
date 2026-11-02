// What is written through a proxy arrives at its target, and compiled code that reads the target finds it.
// Flags: --aot-validate
const proxy = new Proxy(JSON, {});
let sum = 0;
for (let i = 0; i < 1000; i++) { if (i === 500) proxy.added = 7; if (JSON.added !== undefined) sum++; }
console.log(sum);

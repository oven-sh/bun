function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const registry = new FinalizationRegistry(() => { seen = read(); });
(() => { registry.register({}, 1); })();
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 30));
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 30));
if (seen === "not run") seen = "ReferenceError";
const late = { rate: 0.2 };
console.log(seen, read());

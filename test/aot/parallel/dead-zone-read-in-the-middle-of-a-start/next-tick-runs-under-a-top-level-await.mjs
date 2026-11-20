function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
process.nextTick(() => { seen = read(); });
await new Promise(resolve => setImmediate(resolve));
const late = { rate: 0.2 };
console.log(seen, read());

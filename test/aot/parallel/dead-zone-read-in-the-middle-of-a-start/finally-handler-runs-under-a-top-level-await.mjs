function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
Promise.resolve().finally(() => { seen = read(); });
await null;
await null;
const late = { rate: 0.2 };
console.log(seen, read());

function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
async function later() { await null; seen = read(); }
later();
await null;
await null;
await null;
const late = { rate: 0.2 };
console.log(seen, read());

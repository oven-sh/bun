function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
async function* steps() { yield 1; seen = read(); }
const walked = (async () => { for await (const step of steps()); })();
await walked;
const late = { rate: 0.2 };
console.log(seen, read());

function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
setTimeout(() => { seen = read(); }, 0);
await new Promise(resolve => setTimeout(resolve, 30));
const late = { rate: 0.2 };
console.log(seen, read());

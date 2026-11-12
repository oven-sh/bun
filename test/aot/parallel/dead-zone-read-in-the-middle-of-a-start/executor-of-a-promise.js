function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
new Promise(() => { seen = read(); });
const late = { rate: 0.2 };
console.log(seen, read());

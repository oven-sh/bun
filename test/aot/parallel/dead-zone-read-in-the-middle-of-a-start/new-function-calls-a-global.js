function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
globalThis.readLate = read;
seen = new Function("return readLate()")();
const late = { rate: 0.2 };
console.log(seen, read());

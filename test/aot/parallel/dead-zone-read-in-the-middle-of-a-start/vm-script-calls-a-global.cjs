function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
globalThis.readLate = read;
seen = require("node:vm").runInThisContext("readLate()");
const late = { rate: 0.2 };
console.log(seen, read());

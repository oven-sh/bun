function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
JSON.stringify({ a: 1 }, (key, value) => { seen = read(); return value; });
const late = { rate: 0.2 };
console.log(seen, read());

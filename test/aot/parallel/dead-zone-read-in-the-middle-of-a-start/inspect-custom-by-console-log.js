function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const shown = { [Symbol.for("nodejs.util.inspect.custom")]() { seen = read(); return "shown"; } };
console.log(shown);
const late = { rate: 0.2 };
console.log(seen, read());

function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const shown = { [Symbol.for("nodejs.util.inspect.custom")]() { seen = read(); return "shown"; } };
require("node:util").inspect(shown);
const late = { rate: 0.2 };
console.log(seen, read());

function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
Error.prepareStackTrace = () => { seen = read(); return ""; };
new Error("x").stack;
Error.prepareStackTrace = undefined;
const late = { rate: 0.2 };
console.log(seen, read());

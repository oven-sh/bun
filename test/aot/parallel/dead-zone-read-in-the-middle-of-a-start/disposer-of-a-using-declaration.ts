function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
{ using held = { [Symbol.dispose]() { seen = read(); } }; }
const late = { rate: 0.2 };
console.log(seen, read());

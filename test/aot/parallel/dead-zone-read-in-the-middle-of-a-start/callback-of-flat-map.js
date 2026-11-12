function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
[1].flatMap(() => { seen = read(); return []; });
const late = { rate: 0.2 };
console.log(seen, read());

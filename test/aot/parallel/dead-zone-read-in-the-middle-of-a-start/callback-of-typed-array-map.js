function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
new Uint8Array(1).map(() => { seen = read(); return 0; });
const late = { rate: 0.2 };
console.log(seen, read());

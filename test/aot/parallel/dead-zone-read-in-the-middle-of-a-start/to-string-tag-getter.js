function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const tagged = {};
Object.defineProperty(tagged, Symbol.toStringTag, { get() { seen = read(); return "T"; } });
Object.prototype.toString.call(tagged);
const late = { rate: 0.2 };
console.log(seen, read());

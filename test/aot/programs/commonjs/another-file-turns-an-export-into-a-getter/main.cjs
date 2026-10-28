// Another file turns an export into a getter.
const m = require("./m.cjs");
let n = 0;
Object.defineProperty(m, "a", { get() { return "getter " + ++n; }, configurable: true, enumerable: true });
console.log(m.a, m.readA(), require("./other.cjs").see(), JSON.stringify(m));

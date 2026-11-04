// an accessor laid by the program
let reads = 0;
const kept = process.env;
Object.defineProperty(process, "env", { get() { reads++; return kept; }, configurable: true });
console.log(process.env === kept, process.env === kept, reads);

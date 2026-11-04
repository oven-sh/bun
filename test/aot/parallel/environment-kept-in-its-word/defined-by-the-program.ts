// defined by the program
const before = process.env;
Object.defineProperty(process, "env", { value: { A: "defined" }, configurable: true, writable: true });
console.log(process.env === before, process.env.A);

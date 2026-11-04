// replaced by the program
const before = process.env;
console.log(typeof before, before === Bun.env);
process.env = { A: "1" } as any;
console.log(process.env === before, process.env.A, Bun.env === before, Object.keys(process.env).join());

// replaced under a name nobody knows
const name = ["e", "n", "v"].join("");
const before = process.env;
(process as any)[name] = { A: "by a key" };
console.log(process.env === before, process.env.A);

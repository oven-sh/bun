// replaced by a function that is reached late
const hop = (f: any) => f;
function last() { process.env = { A: "late" } as any; }
const before = process.env;
const table = { go: hop(hop(hop(last))) };
console.log(process.env === before);
table.go();
console.log(process.env === before, process.env.A);

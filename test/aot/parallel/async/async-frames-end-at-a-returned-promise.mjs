async function one() { await 1; return two(); }
async function two() { await 1; return new Error("a").stack; }
const outer = async () => (await one()).split("\n").slice(1).map(line => line.trim().split(" (")[0]).join(" | ");
console.log(await outer());

const rounds = Number(process.argv[2] ?? 3);
const box = JSON.parse("{}");
const theirs = new Map<string, string>();
theirs.set("a", "x");
box.theirs = theirs;
const mine = new Map<string, number>();
mine.set("a", 1);
function sum(this: Map<string, number>, keys: string[]): number { let total = 0; for (const key of keys) total = total + this.get(key)!; return total; }
let last = 0;
for (let r = 0; r < rounds; r++) last = sum.call(mine, ["a", "a"]);
console.log(last, sum.call(box.theirs, ["a"]));

const rounds = Number(process.argv[2] ?? 3);
const box = JSON.parse("{}");
const theirs = new Map<string, string>();
theirs.set("a", "x");
box.theirs = theirs;
const mine = new Map<string, number>();
mine.set("a", 1);
function joined(this: Map<string, number>, keys: string[]): string { let text = ""; for (const key of keys) text = text + this.get(key); return text; }
let last = "";
for (let r = 0; r < rounds; r++) last = joined.call(mine, ["a", "a"]);
console.log(last, joined.call(box.theirs, ["a"]));

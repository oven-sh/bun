const rounds = Number(process.argv[2] ?? 3);
const theirs = new Function("const made = new Map(); made.set('a', 'x'); return made;")();
const mine = new Map<string, number>();
mine.set("a", 1);
function joined(this: Map<string, number>, keys: string[]): string { let text = ""; for (const key of keys) text = text + this.get(key); return text; }
let last = "";
for (let r = 0; r < rounds; r++) last = joined.call(mine, ["a", "a"]);
console.log(last, joined.call(theirs, ["a"]));

const rounds = Number(process.argv[2] ?? 3);
const box = JSON.parse("{}");
const key = { made: 1 };
const theirs = new WeakMap<object, string>();
theirs.set(key, "x");
box.theirs = theirs;
const mine = new WeakMap<object, number>();
mine.set(key, 1);
function joined(this: WeakMap<object, number>, keys: object[]): string { let text = ""; for (const each of keys) text = text + this.get(each); return text; }
let last = "";
for (let r = 0; r < rounds; r++) last = joined.call(mine, [key, key]);
console.log(last, joined.call(box.theirs, [key]));

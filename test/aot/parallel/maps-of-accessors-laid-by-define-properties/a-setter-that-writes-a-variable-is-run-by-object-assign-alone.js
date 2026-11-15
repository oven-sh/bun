const seed = Number(process.argv[2] ?? 3);
let kept = 0;
const map = { first: { enumerable: true, get() { return kept; }, set(v) { kept = v; } } };
function lay(o) { Object.defineProperties(o, map); return o; }
const target = lay({});
Object.assign(target, { first: "text" + seed });
const before = kept;
Reflect.set(target, "first", [seed]);
console.log(before, Array.isArray(kept), target.first.length);

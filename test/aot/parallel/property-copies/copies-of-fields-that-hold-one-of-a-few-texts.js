// Fields that hold one of a few texts known at build time are copied by spreads, rests and Object.assign: the same text again and again, then another, then none.
class Holder {
  constructor(kind, level) { this.kind = kind; this.level = level; this.fixed = "three"; this.count = 1; }
}
const kinds = ["first", "second", "third"];
const levels = ["low", "high"];
const lines = [];
function spreadBehind(source, i) { return { label: i, ...source }; }
function restOf(source) { const { count, ...rest } = source; return rest; }
function assigned(source) { return Object.assign({ label: 0 }, source); }
function onto(target, source) { return Object.assign(target, source); }
let sum = 0;
for (let i = 0; i < 400; i++) {
  const holder = new Holder(kinds[(i >> 3) % 3], levels[i & 1]);
  if (i % 97 === 0) holder.kind = undefined;
  if (i % 89 === 0) holder.level = null;
  if (i % 83 === 0) holder.fixed = "made " + i;
  if (i % 79 === 0) delete holder.level;
  const made = [spreadBehind(holder, i), restOf(holder), assigned(holder), onto(new Holder("third", "low"), holder), onto({}, holder)];
  for (const one of made) sum += JSON.stringify(one).length + (one.kind === "second" ? 7 : 0) + (typeof one.fixed === "string" ? one.fixed.length : 0);
  if (i % 37 === 0) lines.push(made.map(one => JSON.stringify(one)).join(" "));
}
lines.push(String(sum));
console.log(lines.join("\n"));

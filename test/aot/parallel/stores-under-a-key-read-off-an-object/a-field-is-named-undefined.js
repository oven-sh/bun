const mark = Symbol.for("made.up.mark");
function pick(i) { return i & 1 ? mark : undefined; }
class Holder {
  constructor(i) {
    this.undefined = i;
    this.other = i + 1;
    this[pick(i)] = "laid";
  }
  sum() { return this.undefined + this.other; }
}
const lines = [];
for (let i = 0; i < 120; i++) {
  const holder = new Holder(i);
  if (i < 4 || i >= 118) lines.push([i, holder.undefined, holder.other, holder.sum(), String(holder[mark]), Reflect.ownKeys(holder).map(String).join()].join(" "));
}
console.log(lines.join("\n"));

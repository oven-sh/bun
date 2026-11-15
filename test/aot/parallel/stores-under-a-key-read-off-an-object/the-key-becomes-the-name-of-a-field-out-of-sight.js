function show(value) { return "shown " + value; }
show.mark = Symbol.for("made.up.mark");
globalThis.kept = [show];
class Holder {
  constructor(first, second) {
    this.first = first;
    this.second = second;
    if (show.mark) this[show.mark] = this.describe;
    this.third = say(this.first) + say(this.second);
  }
  describe() { return say(this.first) + "|" + say(this.second) + "|" + say(this.third); }
}
const lines = [];
function say(value) { return typeof value === "function" ? "a function" : String(value); }
function turn(i) {
  const holder = new Holder(i, i + 1);
  return [holder.first, holder.second, holder.third].map(say).join(" ") + " " + typeof holder[Symbol.for("made.up.mark")] + " " + Reflect.ownKeys(holder).map(String).join();
}
for (let i = 0; i < 120; i++) {
  if (i === 60) {
    globalThis.kept[0][["m", "a", "r", "k"].join("")] = ["s", "e", "c", "o", "n", "d"].join("");
  }
  const line = turn(i);
  if (i < 2 || (i >= 59 && i < 63) || i === 119) lines.push(i + ": " + line);
}
console.log(lines.join("\n"));

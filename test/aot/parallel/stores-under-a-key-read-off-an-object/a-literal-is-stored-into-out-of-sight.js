function show(value) { return "shown " + value; }
show.mark = Symbol.for("made.up.mark");
globalThis.kept = [show];
const lines = [];
function say(value) { return typeof value === "function" ? "a function" : String(value); }
function make(i) {
  const made = { first: i, second: "two", describe() { return say(this.first) + say(this.second); } };
  made[show.mark] = made.describe;
  return made;
}
for (let i = 0; i < 120; i++) {
  if (i === 60) globalThis.kept[0][["m", "a", "r", "k"].join("")] = ["s", "e", "c", "o", "n", "d"].join("");
  if (i === 90) globalThis.kept[0][["m", "a", "r", "k"].join("")] = ["d", "e", "s", "c", "r", "i", "b", "e"].join("");
  const made = make(i);
  let said;
  try { said = say(made.describe()); } catch (error) { said = error.constructor.name; }
  if (i < 2 || (i >= 59 && i < 62) || (i >= 89 && i < 92) || i === 119) lines.push([i, made.first, typeof made.second, said, Reflect.ownKeys(made).map(String).join()].join(" "));
}
console.log(lines.join("\n"));

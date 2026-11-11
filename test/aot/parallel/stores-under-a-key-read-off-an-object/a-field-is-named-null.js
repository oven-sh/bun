const mark = Symbol.for("made.up.mark");
function pick(i) { return i % 3 ? mark : null; }
const lines = [];
for (let i = 0; i < 120; i++) {
  const made = { null: i, other: i + 1 };
  made[pick(i)] = "laid";
  const sum = made.null + made.other;
  if (i < 4 || i >= 118) lines.push([i, made.null, made.other, sum, String(made[mark]), Reflect.ownKeys(made).map(String).join()].join(" "));
}
console.log(lines.join("\n"));

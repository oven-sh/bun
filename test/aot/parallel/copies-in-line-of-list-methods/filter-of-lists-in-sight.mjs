const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
for (let i = 0; i < 400; i++) { said.length = 0; const whole = [i, i + 1, i + 2], halves = [i + 0.5, i + 1.5, i + 2.5], rows = [{ id: i }, { id: i + 1 }], texts = ["a" + i, "b" + i]; said.push(show(whole.filter((v) => v & 1)), show(halves.filter((v) => v > i + 1)), show(rows.filter((r) => r.id & 1)), show(texts.filter((t) => t[0] === "b")), show(whole.filter(() => false)), show([].filter(() => true))); }
console.log(said.join("\n"));

// Flags: --aot-harden=proof-checks
// A sum in a loop takes a length and an element that may be a hole of what each turn finds: NaN where it is a number, the text of undefined where it has become a text.
const box = {};
const unknown = v => { box[JSON.parse('"k"')] = v; return box[JSON.parse('"k"')]; };
function counts(rows) { let t = 0; for (let i = 0; i < rows.length; i++) { const e = rows[i]; for (let j = 0; j < e.length; j++) if (e[j] === 2) t++; t += e.length; t += e[0]; } return t; }
function places(rows) { let t = 0; for (let i = 0; i < rows.length; i++) { const e = rows[i]; for (let j = 0; j < e.length; j++) if (e[j] === 2) t += j; else t++; t += e.length; t += e[0]; } return t; }
function several(rows) { let t = 0; for (let i = 0; i < rows.length; i++) { const e = rows[i]; for (let j = 0; j < e.length; j++) if (e[j] === 2) t++; t += 1; t += e.length; t += e[0]; t += e[1]; } return t; }
const empty = () => { const list = [1.5, 2.5]; list.length = 0; return list; };
const rows = [
  [[1.5, 2], [2.5]], [[1.5], [, 1.5, 2.5]], [[, 1.5]], [empty()], [[1, 2], [, 2]], [[1.5], empty(), [2, 2.5]],
  [{ length: "s" }, empty()], [{ length: "s", 0: 1 }, [, 1.5, 2.5]], ["s", empty()], [[1.5], { length: "s" }, empty(), empty()],
  [[1.5], { length: "s", 0: "q" }, empty(), [2, 2.5]], [new Float64Array([2, 1.5]), { length: "s" }, empty()], [["a"], [, 1.5]], [[2, 2], { length: 1n }],
];
const out = [];
for (let round = 0; round < 40; round++) for (const row of rows) for (const f of [counts, places, several]) {
  try { out.push(String(f(unknown(row)))); } catch (error) { out.push(error.constructor.name); }
}
console.log(out.slice(0, rows.length * 3).join("\n"));
console.log(out.slice(-rows.length * 3).join("\n"));

// Lists of fractions with a hole late, last, first, at every second place, at every place are spread first into a literal in a loop: the copy holds the fractions as values and undefined at the holes;
// so does the copy behind which a text is written. Each copy is then pushed onto, stored into, shortened and lengthened, and the list given stays as it was.
// STATISTIC: ArrayLiteralsAllocatedFromSpread >= 3
const turns = JSON.parse("4");
function copies(given) { const made = []; for (let i = 0; i < turns; i++) made.push([...given]); return made; }
function grown(given, more) { const made = []; for (let i = 0; i < turns; i++) made.push([...given, more]); return made; }
function grownByHalves(given) { const made = []; for (let i = 0; i < turns; i++) made.push([...given, i / 2, i]); return made; }
function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i] * (i + 1); return sum; }
globalThis.kept = [copies, grown, grownByHalves, total];
const word = value => value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
const show = list => { const words = []; for (let i = 0; i < list.length; i++) words.push(i in list ? word(list[i]) : "hole"); return list.length + ":" + JSON.stringify(words.length > 12 ? words.slice(0, 5).concat("..", words.slice(-5)) : words) + " " + total(list); };
const halves = length => Array.from({ length }, (_, i) => i + 0.5);
const givens = [
  ["a hole late among sixteen", () => { const l = halves(16); delete l[13]; return l; }], ["a hole last of 125", () => { const l = halves(125); delete l[124]; return l; }], ["a hole first of 125", () => { const l = halves(125); delete l[0]; return l; }],
  ["a hole last of 127", () => { const l = halves(127); delete l[126]; return l; }], ["a hole last of 128", () => { const l = halves(128); delete l[127]; return l; }], ["every second place a hole", () => { const l = halves(24); for (let i = 1; i < 24; i += 2) delete l[i]; return l; }],
  ["holes alone", () => { const l = halves(9); for (let i = 0; i < 9; i++) delete l[i]; return l; }], ["a hole beside -0 and the infinities", () => { const l = [0.5, -0, Infinity, -Infinity, 1.5]; delete l[4]; return l; }],
  ["whole numbers held as fractions and a hole", () => { const l = [0.5, 1, 2, 3]; l[0] = 4; delete l[2]; return l; }], ["whole numbers held as fractions", () => { const l = [0.5, 1, 2, 3]; l[0] = 4; return l; }],
  ["2^31, 2^53 and a hole", () => { const l = [0.5, 2147483648, 9007199254740992, 1.5]; delete l[0]; return l; }], ["the least and a hole", () => { const l = [5e-324, -5e-324, 0.5]; delete l[2]; return l; }],
];
for (const [name, make] of givens) {
  for (const [label, go] of [["alone", copies], ["and a fraction", g => grown(g, 0.75)], ["and a whole number", g => grown(g, 9)], ["and a text", g => grown(g, "t")], ["and undefined", g => grown(g, undefined)], ["and two", grownByHalves]]) {
    const given = make(), before = show(given), made = go(given), last = made[made.length - 1];
    let said = show(last);
    last.push(0.125); said += " | " + show(last);
    last.push(11); said += " | " + show(last);
    last.push("text"); last[0] = null; said += " | " + show(last);
    made[0][0] = 5.5; made[0].length = 2; made[1].length += 2;
    console.log(name, "|", label, "|", said, "|", show(made[0]), "|", show(made[1]), "|", show(made[2]), "|", show(given) === before);
  }
}

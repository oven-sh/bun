// Lists whose storage is one of fractions are spread first into a literal in a loop: the copy holds them raw. A hole among them is undefined in the copy; NaN, -0 and the infinities stay what they are;
// 127 and 128 elements; what is written behind is a fraction, a whole number, a text, nothing. Each copy is then pushed onto, stored into and shortened, and the list given stays as it was.
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
  ["three", () => [0.5, 1.5, 2.5]], ["one", () => [0.25]], ["emptied", () => { const l = [0.5]; l.pop(); return l; }], ["whole numbers among them", () => [0.5, 1, 2, 3.5]],
  ["a hole in the middle", () => { const l = [0.5, 1.5, 2.5]; delete l[1]; return l; }], ["a hole first", () => { const l = [0.5, 1.5]; delete l[0]; return l; }], ["a hole last", () => { const l = [0.5, 1.5, 2.5]; delete l[2]; return l; }],
  ["written with a hole", () => [0.5, , 2.5]], ["lengthened", () => { const l = [0.5, 1.5]; l.length = 4; return l; }], ["NaN stored", () => { const l = [0.5, 1.5, 2.5]; l[1] = NaN; return l; }], ["NaN reckoned", () => [0.5, 0 / 0, 2.5]],
  ["-0", () => [0.5, -0, 1.5]], ["the infinities", () => [0.5, Infinity, -Infinity]], ["the greatest and the least", () => [Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE, 0.5]], ["2^31 and 2^53", () => [0.5, 2147483648, 9007199254740992]],
  ["126", () => halves(126)], ["127", () => halves(127)], ["128", () => halves(128)], ["400", () => halves(400)], ["out of JSON", () => JSON.parse("[0.5,1.25,3]")], ["what a map gave", () => [1, 2, 3].map(n => n / 4)],
  ["a slice", () => halves(9).slice(2, 7)], ["frozen", () => Object.freeze([0.5, 1.5])], ["with a name", () => Object.assign([0.5, 1.5], { name: "n" })],
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

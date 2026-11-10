// A list whose storage is one of values and that holds whole numbers alone (a slice of a mixed list, a concat, what a map gave) is spread in a loop: the copy is read by loops over numbers, stored into,
// pushed onto with a whole number, a fraction, a text; a whole number comes late, early or never among the values. Each answer is held against plain Bun's.
// STATISTIC: LiteralsBornHoldingTheListSpreadRightBehind >= 3
const turns = JSON.parse("4");
function copies(given) { const made = []; for (let i = 0; i < turns; i++) made.push([...given]); return made; }
function grown(given, more) { const made = []; for (let i = 0; i < turns; i++) made.push([...given, more]); return made; }
function grownByWhole(given) { const made = []; for (let i = 0; i < turns; i++) made.push([...given, i]); return made; }
function total(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum = (sum * 31 + (list[i] | 0)) % 1000003; return sum; }
globalThis.kept = [copies, grown, grownByWhole, total];
const show = list => JSON.stringify(list.map(value => value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : value)) + " " + total(list);
const givens = [
  ["a slice of a mixed list", () => ["x", 1, 2, 3, 4].slice(1)], ["a concat", () => [1, 2].concat([3, 4], 5)], ["what a map gave", () => ["a", "bb", "ccc"].map(text => text.length)],
  ["a whole number last", () => ["a", "b", 3]], ["a whole number first", () => [1, "b", "c"]], ["a text in the middle", () => [1, 2, "three", 4, 5]], ["a fraction in the middle of values", () => ["x", 1, 2.5, 3].slice(1)],
  ["2^31", () => ["x", 1, 2147483648, -2147483649].slice(1)], ["-0 among values", () => ["x", 1, -0, 2].slice(1)], ["a hole among whole numbers in values", () => { const l = ["x", 1, 2, 3].slice(1); delete l[1]; return l; }],
  ["null and undefined", () => [1, null, undefined, 2]], ["true", () => [1, true, 2]], ["one whole number", () => ["x", 7].slice(1)], ["nothing left", () => ["x"].slice(1)], ["whole numbers", () => [1, 2, 3]],
];
for (const [name, make] of givens) {
  for (const [label, go] of [["alone", copies], ["and a text", g => grown(g, "t")], ["and a fraction", g => grown(g, 0.5)], ["and a whole number", g => grown(g, 9)], ["and the turn", grownByWhole]]) {
    const given = make(), made = go(given), last = made[made.length - 1];
    let said = show(last);
    last.push(11); said += " | " + show(last);
    last.push(1.25); said += " | " + show(last);
    last[0] = "first"; last.push("text"); said += " | " + show(last);
    made[0][0] = 5; made[0].length = 2;
    console.log(name, "|", label, "|", said, "|", show(made[0]), "|", show(made[1]), "|", show(given));
  }
}

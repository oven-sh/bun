// answers: with-library
// # Parts of a concatenation that are string constants: at their first use and later, in each place, beside values that throw, in long and in growing texts.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 61 of 61 of 61
// # CHECK-NEXT: exited with 0
function greet(name) { return `Hello, ${name}!!`; }
function before(x) { return "value: " + x; }
function behind(x) { return x + " units"; }
function between(a, b) { return `${a} and ${b}`; }
function row(a, b, c) { return `first ${a}, second ${b}, third ${c}.`; }
function two(a, b) { return `${a}${b} -- joined`; }
function front(a, b) { return `pair ${a}${b}`; }
function path(a, b, c, d) { return `/api/${a}/items/${b}/parts/${c}?query=${d}`; }
function repeated(a) { return `same text ${a}same text ${a}same text `; }
function wide(a) { return `an ellipsis… ${a} 日本 and back`; }
function single(a) { return `(${a})`; }
function empty(a) { return `${a}${""}` + "" + `${""}only constants`; }
function long(a) { return `${"a long constant that is written once and read by each call of this function, ".concat("twice")} ${a} behind it`; }
function mixedParts(n, b, u, o) { return `n=${n} b=${b} u=${u} o=${o} end of parts`; }
function withNumbers(a, b, c, d, name) {
  const x = a * b, y = a / c, z = b - d, w = c * d + 0.5;
  const text = `numbers around ${name}, kept in registers`;
  return text + " " + (x + y + z + w) + " " + x + " " + y + " " + z + " " + w;
}
function caught(value) {
  try {
    return `before the symbol ${value} behind it`;
  } catch (error) {
    return `caught a ${error.name} here`;
  }
}
function concat(a) { return "by a method ".concat(a, " and more"); }
function inLoop(list) {
  let text = "";
  for (const item of list) text += `item ${item}; `;
  return text;
}
class Label {
  constructor(name) { this.name = name; }
  toString() { return `label ${this.name} as a text`; }
  get [Symbol.toStringTag]() { return "Label"; }
}
const label = new Label("inner");
for (let round = 0; round < 3; round++) {
  report(greet("name" + round) + " " + greet(round) + " " + greet(label));
  report(before(round) + "|" + before("a" + round) + "|" + before(null) + "|" + before(undefined));
  report(behind(round) + "|" + behind("a" + round) + "|" + behind(0.5) + "|" + behind(-0));
  report(between("a" + round, round) + "|" + between(round, "b"));
  report(row("a" + round, round, true));
  report(two("x" + round, "y") + "|" + front("x", "y" + round));
  report(path("a" + round, round, "ü", "q q"));
  report(repeated("r" + round));
  report(wide("w" + round) + wide(round).length);
  report(single("s" + round) + "|" + empty("e" + round));
  report(long("l" + round));
  report(mixedParts(round, !round, undefined, [round, "x"]) + mixedParts(1.25, false, null, { a: 1 }) + mixedParts(10n, true, Symbol.iterator.description, label));
  report(withNumbers(round + 0.25, 3, 7, 2.5, "name" + round));
  report(caught("no symbol") + "|" + caught(Symbol("s")) + "|" + caught({ toString() { throw new RangeError("thrown"); } }));
  report(concat("c" + round));
  report(inLoop([round, "x" + round, null]));
  report(`${label}` + "|" + `[${label}] in brackets`);
}
let half = "half of it ";
while (half.length < 2 ** 30) half += half;
for (const join of [a => `${a}${a} too long`, a => `too long: ${a}${a}`, a => "too long: " + a + a, a => `${a} too long ${a}`]) {
  try {
    report("length " + join(half).length);
  } catch (error) {
    report(error instanceof RangeError);
  }
}
let length = 0, sum = 0;
for (let i = 0; i < 200000; i++) {
  const text = row(i, "b" + i, i & 1);
  length += text.length;
  sum = (sum * 31 + text.charCodeAt(text.length - 5)) >>> 0;
}
report(length + " " + sum);
let grown = "";
for (let i = 0; i < 5000; i++) grown = grown + " piece" + i;
report(grown.length + " " + grown.slice(-12));
report(Object.keys({ [`key ${1 + length * 0} of an object`]: 1, ["other " + label.name]: 2 }).join(","));
report(new Error(`message ${label.name} of an error`).message);
report([1, 2, 3].map(n => `<li>${n}</li>`).join(""));
report("end");

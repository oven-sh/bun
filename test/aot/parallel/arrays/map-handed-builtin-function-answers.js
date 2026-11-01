// Map is handed a built in function that answers numbers.
function show(list) {
  const parts = [];
  for (let index = 0;index < list.length; index++)
    parts.push(index in list ? Object.is(list[index], -0) ? "-0" : String(list[index]) : "hole");
  return `${list.length}[${parts.join(",")}] ${Object.keys(list).join("")}`;
}
const lines = [];
const texts = ["10", "11", "12", " 7 ", "", "x", "0x1f", "1e3", "-0", "Infinity"];
const numbers = [4, -2.5, 0, -0, NaN, 9, 2147483648, 1000000000000000000000];
const mixed = ["3", 4, null, undefined, true, [5], { valueOf: () => 6 }, "seven"];
const holed = ["1", , "3", , "5"];
lines.push("Number " + show(texts.map(Number)) + " " + show(numbers.map(Number)) + " " + show(mixed.map(Number)) + " " + show(holed.map(Number)));
lines.push("parseInt " + show(texts.map(parseInt)) + " " + show(holed.map(parseInt)) + " " + show(["10", "10", "10", "10", "10"].map(parseInt)));
lines.push("parseFloat " + show(texts.map(parseFloat)) + " " + show(texts.map(Number.parseFloat)) + " " + show(holed.map(parseFloat)));
lines.push("abs " + show(numbers.map(Math.abs)) + " sqrt " + show(numbers.map(Math.sqrt)) + " round " + show(numbers.map(Math.round)) + " sign " + show(numbers.map(Math.sign)));
lines.push("max " + show(numbers.map(Math.max)) + " min " + show([1, 2, 3].map(Math.min)) + " hypot " + show([3, 4].map(Math.hypot)) + " pow " + show([2, 3, 4, 5].map(Math.pow)));
lines.push("atan2 " + show([1, 2, 3].map(Math.atan2)) + " imul " + show([7, 8, 9].map(Math.imul)) + " trunc " + show(texts.map(Math.trunc)));
lines.push("parse " + show(["2020-01-02T03:04:05Z", "no"].map(Date.parse)) + " utc " + show([2020, 2021, 2022].map(Date.UTC)));
lines.push("this " + show(texts.map(Number, { any: 1 })) + " empty " + show([].map(Number)));
try {
  lines.push(show([1n, 2n].map(Number)) + " " + show([Symbol.iterator].map(Number)));
} catch (error) {
  lines.push(String(error));
}
const order = [];
const watched = [
  { valueOf: () => (order.push("a"), 1) },
  { valueOf: () => (order.push("b"), 2) },
  {
    valueOf: () => {
      order.push("c");
      throw new RangeError("third");
    }
  },
  { valueOf: () => (order.push("d"), 4) }
];
try {
  watched.map(Number);
} catch (error) {
  lines.push(String(error) + " " + order.join(""));
}
const shrinking = ["1", "2", "3", "4"];
lines.push(show([{ valueOf: () => (shrinking.length = 2, 1) }, ...shrinking].map(Number)) + " " + show(shrinking));

class Below extends Array {
}
const below = Below.from(["1", "2"]);
const mapped = below.map(Number);
lines.push("below " + (mapped instanceof Below) + " " + show(mapped));
let total = 0;
for (let turn = 0;turn < 400; turn++) {
  const parsed = "0,1,2,3,4,5,6,7,8,9".split(",").map(Number);
  for (let index = 0;index < parsed.length; index++)
    parsed[index] = parsed[index] * 2 + turn;
  total += parsed[9] - parsed[0];
  parsed.push("text");
  total += parsed.length;
}
lines.push("total " + total);
console.log(lines.join(`
`));

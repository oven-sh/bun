// The list that the library's own map makes is born for integers. What the function hands back is stored at the first try where it is an integer, whatever the list holds by then, and as before where it is anything else. Each map here is entered by value: the function that calls it comes out of a table.
const turns = JSON.parse("3");
const sources = JSON.parse('[[1,2,3,4,5,6],[1.5,2,3],["a",2,null],[],[0],[2147483647,-2147483648,1]]');
const makers = {
  integers: x => (typeof x === "number" ? (x | 0) + 1 : 7),
  integersThenFraction: (x, i) => (i < 2 ? i : i + 0.5),
  fractionThenIntegers: (x, i) => (i === 0 ? 0.25 : i),
  integersThenText: (x, i) => (i < 2 ? i : "t" + i),
  textThenIntegers: (x, i) => (i === 0 ? "first" : i),
  integersThenObject: (x, i) => (i < 1 ? i : { at: i }),
  objectThenIntegers: (x, i) => (i === 0 ? { at: 0 } : i),
  undefinedAmongIntegers: (x, i) => (i % 2 ? undefined : i),
  nullAmongIntegers: (x, i) => (i % 2 ? null : i),
  booleansAmongIntegers: (x, i) => (i % 2 ? true : i),
  minusZero: (x, i) => (i % 2 ? -0 : i),
  notANumber: (x, i) => (i % 2 ? NaN : i),
  beyondIntegers: (x, i) => (i % 2 ? 2147483648 : -2147483648),
  bigIntegers: (x, i) => (i % 2 ? 10n : i),
  symbols: (x, i) => (i % 2 ? Symbol.iterator : i),
  itself: x => x,
};
class Kept extends Array {
  static get [Symbol.species]() { return function (length) { return Kept.handedOut; }; }
}
function show(list) {
  if (!Array.isArray(list)) return String(list);
  let text = "#" + list.length + " ";
  for (let i = 0; i < list.length; i++) text += (i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] ? JSON.stringify(list[i]) : typeof list[i] === "bigint" ? list[i] + "n" : String(list[i])) : "hole") + ",";
  const last = list.length ? list[list.length - 1] : undefined;
  text += " found at " + list.indexOf(last) + " " + list.lastIndexOf(last) + " " + list.includes(last) + " joined " + list.map(String).join("|").length;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += typeof list[i] === "number" ? list[i] : 1000;
  return text + " sum " + sum;
}
const callers = Object.keys(makers).map(name => source => source.map(makers[name]));
const out = [];
for (let turn = 0; turn < turns; turn++) {
  Object.keys(makers).forEach((name, which) => {
    for (const source of sources) {
      const made = callers[which](source);
      if (turn === turns - 1) {
        Bun.gc(true);
        for (let filler = 0; filler < 2000; filler++) globalThis.lastFiller = { at: "filler" + filler, more: [filler] };
        Bun.gc(true);
      }
      const line = name + " " + show(made);
      if (turn === turns - 1) out.push(line);
    }
  });
}
for (const handedOut of [[9, 9], [9, 9, 9, 9, 9, 9, 9, 9], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], ["x", "x", "x", "x", "x", "x"], Object.freeze([1, 2, 3, 4, 5, 6]), Object.seal([1, 2, 3, 4, 5, 6]), Object.preventExtensions([1, 2]), [, , , , , ,], new Array(6)]) {
  for (const name of ["integers", "integersThenText", "integersThenFraction"]) {
    Kept.handedOut = handedOut;
    let line;
    try { const made = Kept.from([1, 2, 3, 4, 5, 6]).map(makers[name]); line = show(made) + " the same list: " + (made === handedOut); } catch (error) { line = error.constructor.name + ": " + error.message.split(" (In ")[0]; }
    out.push("handed out " + name + " " + line + " | " + show(handedOut));
  }
}
const literal = () => [1, 2, 3];
const first = literal();
Kept.handedOut = first;
out.push("a written list " + show(Kept.from([5, 6, 7]).map(x => x * 2)) + " | " + show(literal()));
console.log(out.join("\n"));

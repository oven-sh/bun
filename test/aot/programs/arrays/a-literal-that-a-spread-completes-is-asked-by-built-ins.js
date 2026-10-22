// `const list = [...iterable]` and then `list.includes(x)`, `join`, `indexOf`, `at`, `length`: what a spread puts into a literal is no store that stands in the text. A compiler that reads the
// literal at the build as "a list of constants that nobody writes to" reads `[]`, or only the constants beside the spread.
function* words() {
  yield "one";
  yield "two";
  yield "three";
}
class Shelf {
  constructor(...books) {
    this.books = books;
  }
  *[Symbol.iterator]() {
    yield* this.books;
  }
}
const stepped = {
  [Symbol.iterator]() {
    let step = 0;
    return { next: () => (step < 3 ? { done: false, value: "step " + step++ } : { done: true, value: undefined }) };
  },
};

function ofAGenerator(wanted) {
  const list = [...words()];
  return [list.includes(wanted), list.indexOf(wanted), list.join(), list.length, list.at(-1)].join(" ");
}
function besideConstants(wanted) {
  const list = ["zero", ...words(), "four"];
  return [list.includes(wanted), list.indexOf(wanted), list.lastIndexOf("four"), list.join("+"), list.length, list.at(1)].join(" ");
}
function ofASet(wanted) {
  const list = [...new Set(["one", "two", "one"])];
  return [list.includes(wanted), list.join(), list.length].join(" ");
}
function ofTheKeysOfAMap(wanted) {
  const list = [...new Map([["one", 1], ["two", 2]]).keys()];
  return [list.includes(wanted), list.join(), list.length].join(" ");
}
function ofAText(wanted) {
  const list = [..."two"];
  return [list.includes(wanted), list.includes("w"), list.join("-"), list.length].join(" ");
}
function ofAnInstance(wanted) {
  const list = [...new Shelf("one", "two")];
  return [list.includes(wanted), list.join(), list.length].join(" ");
}
function ofAnIteratorWrittenByHand(wanted) {
  const list = [...stepped];
  return [list.includes(wanted), list.includes("step 1"), list.join(), list.length].join(" ");
}
function ofItsArguments() {
  const list = [...arguments];
  return [list.includes("two"), list.join(), list.length].join(" ");
}
function ofAParameter(given, wanted) {
  const list = [...given];
  return [list.includes(wanted), list.join(), list.length].join(" ");
}
function ofTwoSpreads(wanted) {
  const list = [...words(), ...stepped];
  return [list.includes(wanted), list.includes("step 2"), list.length, list.slice(2, 4).join()].join(" ");
}
function ofNumbers(wanted) {
  const list = [1, 2, ...new Set([3, 4])];
  return [list.includes(wanted), list.indexOf(4), Math.max(...list), list.reduce((sum, each) => sum + each, 0), list.some(each => each > 3), list.every(each => each < 3)].join(" ");
}
function usedOnce(wanted) {
  return [...words()].includes(wanted) + " " + [...words()].join() + " " + [...stepped].length;
}

const rows = [];
// Often enough that each function is compiled in the form for code that runs often.
for (let round = 0; round < 300; round++) {
  rows.length = 0;
  rows.push(
    ofAGenerator("two"),
    ofAGenerator("none"),
    besideConstants("three"),
    besideConstants("none"),
    ofASet("two"),
    ofTheKeysOfAMap("two"),
    ofAText("two"),
    ofAnInstance("two"),
    ofAnIteratorWrittenByHand("none"),
    ofItsArguments("one", "two"),
    ofAParameter(words(), "three"),
    ofAParameter(["one"], "one"),
    ofAParameter(new Set(), "one"),
    ofTwoSpreads("one"),
    ofNumbers(3),
    ofNumbers(5),
    usedOnce("two"),
  );
}
for (const row of rows) console.log(row);

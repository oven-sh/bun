// `typeof` of a value that folds, one kind after another, and a text constant behind a flag that `typeof` decides.
// Every kind and every text comes twice in one function.
function written() {
  return [
    typeof 0.5,
    typeof 0.25,
    typeof 1,
    typeof 2,
    typeof "a",
    typeof "b",
    typeof true,
    typeof false,
    typeof undefined,
    typeof void 0,
    typeof null,
    typeof null,
    typeof 1n,
    typeof 2n,
    typeof Symbol.iterator,
    typeof Symbol.hasInstance,
    typeof function () {},
    typeof (() => {}),
    typeof class {},
    typeof written,
    typeof process,
    typeof process,
    typeof Math,
    typeof JSON,
    typeof [],
    typeof {},
  ].join();
}
console.log(written());
console.log(written());

// The front end folds none of these. Each loop has seven turns, few enough to be written out, and in a turn the element is what the list was given.
function numbersAndTexts(extra) {
  const list = [0.5, 0.25, 1, 2, "a", "b"];
  list.push(extra);
  let text = "";
  for (let i = 0; i < list.length; i++) text += typeof list[i] + ",";
  return text;
}
function booleansAndNothing(extra) {
  const list = [true, false, undefined, undefined, null, null];
  list.push(extra);
  let text = "";
  for (let i = 0; i < list.length; i++) text += typeof list[i] + ",";
  return text;
}
function cells(extra) {
  const list = [1n, 2n, Symbol.iterator, Symbol.hasInstance, written, process];
  list.push(extra);
  let text = "";
  for (let i = 0; i < list.length; i++) text += typeof list[i] + ",";
  return text;
}
console.log(numbersAndTexts(1.5), booleansAndNothing(1.5), cells(1.5));
console.log(numbersAndTexts("six"), booleansAndNothing("six"), cells("six"));
console.log(numbersAndTexts(undefined), booleansAndNothing(undefined), cells(undefined));

const ofProcess = typeof process === "object";
const first = ofProcess ? "http://localhost" : "https://example.com";
const ofProcessAgain = typeof process === "object";
const second = ofProcessAgain ? "http://localhost" : "https://example.com";
const ofText = typeof "a" === "string";
const third = !ofText ? "dev" : "prod";
const ofTextAgain = typeof "a" === "string";
const fourth = !ofTextAgain ? "dev" : "prod";
console.log(first, second, third, fourth);

function byTruth(x) {
  if (x) return "yes";
  return "no";
}
function byText(x) {
  switch (x) {
    case "a":
      return "first";
    case "b":
      return "second";
  }
  return "other";
}
console.log(byTruth([]), byTruth(0), byTruth([0]), byTruth(""));
console.log(byText("a"), byText(["a"]), byText("b"), byText("c"), byText("a"), byText("b"));

const text = value => (Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value));
const show = list => {
  const shown = [];
  for (let i = 0; i < list.length; i++) shown.push(i in list ? text(list[i]) : "hole");
  return list.length + ": " + shown.join(" ");
};

const whole = [1, 2, 3];
const more = [4, 5, 6];
const fractions = [1.5, 2.5, -0];
const texts = ["a", "b"];
const mixed = [1, "two", null, undefined, 2.5];
const wholeWithAHole = [1, , 3];
const fractionsWithAHole = [0.5, , 1.5];
const textsWithAHole = ["a", , "c"];
const withNaN = [1.5, NaN, Infinity];
const none = [];

function wholeThenWritten(i) { return whole.concat(more, [i]); }
function wholeThenAFraction(i) { return whole.concat([i + 0.5]); }
function wholeThenAText(i) { return whole.concat(["t" + i]); }
function wholeThenAnObject(i) { return whole.concat([{ i }])[3].i; }
function fractionsThenWhole(i) { return fractions.concat([7], more, [i]); }
function fractionsThenAText(i) { return fractions.concat(["t" + i], [i]); }
function fractionsThenNothing(i) { return fractions.concat([undefined], [null], [i]); }
function textsThenWhole(i) { return texts.concat([i], whole); }
function textsThenAFraction(i) { return texts.concat([i / 4], fractions); }
function writtenThenWhole(i) { return [i].concat(whole); }
function writtenThenFractions(i) { return [i, i + 1].concat(fractions, [i * 0.25]); }
function writtenThenTexts(i) { return [i * 0.5].concat(texts); }
function holesThenWritten(i) { return wholeWithAHole.concat([i + 0.5]); }
function holesOfFractionsThenAText(i) { return fractionsWithAHole.concat(["t" + i]); }
function holesOfTextsThenAFraction(i) { return textsWithAHole.concat([i + 0.5], fractionsWithAHole); }
function notANumberThenWhole(i) { return withNaN.concat([i], whole); }
function wholeThenNotANumber(i) { return whole.concat([i / 0 - i / 0], withNaN); }
function large(i) { return whole.concat([2147483647 + i], [-2147483648 - i], [i * 4294967296]); }
function minusZero(i) { return whole.concat([i * -0]); }
function nothingThenWritten(i) { return none.concat([i], [i + 0.5], ["t"]); }
function mixedThenWritten(i) { return mixed.concat([i], [i + 0.5]); }
function handedIn(list, i) { return list.concat([i], [i + 0.5]); }
function bothHandedIn(list, other, i) { return list.concat(other, [i]); }
function storedIntoNext(i) {
  const both = whole.concat(more, [i]);
  both[1] = 0.25;
  both[7] = "end";
  return both;
}

const all = { whole, more, fractions, texts, mixed, wholeWithAHole, fractionsWithAHole, textsWithAHole, withNaN, none };
for (let i = 0; i < 4; i++) {
  for (const make of [wholeThenWritten, wholeThenAFraction, wholeThenAText, fractionsThenWhole, fractionsThenAText, fractionsThenNothing, textsThenWhole, textsThenAFraction, writtenThenWhole, writtenThenFractions, writtenThenTexts, holesThenWritten, holesOfFractionsThenAText, holesOfTextsThenAFraction, notANumberThenWhole, wholeThenNotANumber, large, minusZero, nothingThenWritten, mixedThenWritten, storedIntoNext])
    console.log(make.name, i, show(make(i)));
  console.log("wholeThenAnObject", i, wholeThenAnObject(i));
  for (const [name, list] of Object.entries(all)) {
    console.log("handedIn", name, i, show(handedIn(list, i)));
    for (const [otherName, other] of Object.entries(all)) console.log("bothHandedIn", name, otherName, i, show(bothHandedIn(list, other, i)));
  }
}
for (const [name, list] of Object.entries(all)) console.log("as it was", name, show(list));

let sum = 0;
for (let i = 0; i < 20000; i++) {
  const both = wholeThenWritten(i);
  sum += both[6] + both.length + fractionsThenWhole(i)[7] + textsThenWhole(i).length + writtenThenFractions(i)[5];
}
console.log(sum);

class Row extends Array {}
const row = Row.from([1, 2, 3]);
console.log(show(row.concat([0.5])), row.concat([0.5]) instanceof Row);
const named = [1, 2, 3];
named.label = "kept on the list, not on the new one";
console.log(show(named.concat([0.5])), named.concat([0.5]).label);
const spreadable = { length: 2, 0: "x", 1: "y", [Symbol.isConcatSpreadable]: true };
console.log(show(whole.concat(spreadable, [0.5])));
const closed = [8, 9];
closed[Symbol.isConcatSpreadable] = false;
console.log(whole.concat(closed, [0.5]).length, whole.concat(closed, [0.5])[3] === closed);
const frozen = Object.freeze([1, 2]);
console.log(show(frozen.concat([0.5])), Object.isFrozen(frozen.concat([0.5])));
const sparse = [1, 2];
sparse[5000] = 3;
console.log(sparse.concat([0.5]).length, sparse.concat([0.5])[5001]);

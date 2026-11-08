const text = value => (Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value));
const show = list => {
  const shown = [];
  for (let i = 0; i < list.length; i++) shown.push(i in list ? text(list[i]) : "hole");
  return list.length + ": " + shown.join(" ");
};

const whole = [1, 2, 3];
const fractions = [1.5, -0, 2.5];
const texts = ["a", "b"];
const wholeWithAHole = [1, , 3];
const fractionsWithAHole = [0.5, , 1.5];

function wholeAndWritten(i) { return [].concat(whole, [i & 7]); }
function wholeAndAnyWhole(i) { return [].concat(whole, [i * 1000000007]); }
function fractionsAndWhole(i) { return [].concat(fractions, whole, [i]); }
function wholeAndFractions(i) { return [].concat(whole, fractions, [i]); }
function wholeAndTexts(i) { return [].concat(whole, texts, [i + 0.5]); }
function textsAndFractions(i) { return [].concat(texts, fractions); }
function writtenAlone(i) { return [].concat([i], [i + 0.5], ["t" + i]); }
function elementFirst(i) { return [].concat(i, whole, [i + 0.5]); }
function holes(i) { return [].concat(wholeWithAHole, fractionsWithAHole, [i]); }
function nothing() { return [].concat(); }
function nothingTwice() { return [].concat([]); }
function handedIn(list, i) { return [].concat(list, [i]); }
function notEmptyAfterAll(i) {
  const stretched = [];
  stretched.length = 2;
  return stretched.concat(whole, [i]);
}
function madeWithALength(i) { return new Array(2).concat(whole, [i]); }
function storedIntoNext(i) {
  const both = [].concat(whole, [i & 7]);
  both[0] = 0.5;
  both.push("end");
  return both;
}

for (let i = 0; i < 4; i++) {
  for (const make of [wholeAndWritten, wholeAndAnyWhole, fractionsAndWhole, wholeAndFractions, wholeAndTexts, textsAndFractions, writtenAlone, elementFirst, holes, nothing, nothingTwice, notEmptyAfterAll, madeWithALength, storedIntoNext])
    console.log(make.name, i, show(make(i)));
  for (const list of [whole, fractions, texts, wholeWithAHole, fractionsWithAHole, []]) console.log("handedIn", i, show(handedIn(list, i)));
}
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const both = wholeAndWritten(i);
  sum += both.length + both[3] + wholeAndFractions(i)[6] + wholeAndTexts(i).length;
}
console.log(sum, show(whole), show(fractions), show(texts), show(wholeWithAHole), show(fractionsWithAHole));

// What is caught is told apart by `instanceof`. A class below Error finds Symbol.hasInstance two objects further up than a class of its own, and that is all the difference there is.
class Plain {}
class OtherPlain {}
class Below extends Error {}
class OtherBelow extends Error {}
function kindOf(thrown, First, Second) {
  try {
    throw thrown;
  } catch (caught) {
    return caught instanceof First ? 1 : caught instanceof Second ? 2 : 3;
  }
}
function throwAndTell(values, First, Second) {
  let sum = 0;
  for (let i = 0; i < 200000; i++) sum += kindOf(values[i & 1], First, Second);
  return sum;
}
function fastestOf(runs, values, First, Second) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (throwAndTell(values, First, Second) !== 300000) console.log("told apart wrongly");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const plain = fastestOf(5, [new Plain(), new OtherPlain()], Plain, OtherPlain);
const below = fastestOf(5, [new Below("a"), new OtherBelow("b")], Below, OtherBelow);
console.log(below < plain * 3 ? "a class below Error is told apart in under three times the time" : "a class below Error took over three times the time");

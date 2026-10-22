// A variable declared by `var`, or by `let` without a value, holds `undefined` until a store has run. Where every store in the program, those through setters among them, stores closures of one function, `undefined` or `null`, all that is open at a call is whether the variable holds nothing: the call asks that and is a direct call otherwise. A call that comes too early or too late throws as it always did.
// IR+ ^variable g\d+ name="bySetter" .*declared=(undefined\|)?(null\|)?f\d+( |$)
// IR+ ^variable g\d+ name="bySetterAndCleared" .*declared=(undefined\|)?(null\|)?f\d+( |$)
// IR+ ^variable g\d+ name="bySetterAndClearedWithNull" .*declared=(undefined\|)?(null\|)?f\d+( |$)
// IR- ^variable g\d+ name="oneOfTwoBySetter" .*declared=(undefined\|)?(null\|)?f\d+( |$)
// IR- ^variable g\d+ name="sometimesANumberBySetter" .*declared=(undefined\|)?(null\|)?f\d+( |$)
var bySetter;
var bySetterAndCleared;
var bySetterAndClearedWithNull;
var oneOfTwoBySetter;
var sometimesANumberBySetter;

function setBySetter(fn) { bySetter = fn; }
function setBySetterAndCleared(fn) { bySetterAndCleared = fn; }
function setBySetterAndClearedWithNull(fn) { bySetterAndClearedWithNull = fn; }
function setOneOfTwoBySetter(fn) { oneOfTwoBySetter = fn; }
function setSometimesANumberBySetter(fn) { sometimesANumberBySetter = fn; }

function attempt(call) {
  try {
    return String(call());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "something else";
  }
}
function callBySetter(n) { return bySetter(n); }
function callBySetterAndCleared(n) { return bySetterAndCleared(n); }
function callBySetterAndClearedWithNull(n) { return bySetterAndClearedWithNull(n); }
function callOneOfTwoBySetter(n) { return oneOfTwoBySetter(n); }
function callSometimesANumberBySetter(n) { return sometimesANumberBySetter(n); }

console.log(attempt(() => callBySetter(4)));
setBySetter(function (n) { return n * 2; });
console.log(attempt(() => callBySetter(4)));

console.log(attempt(() => callBySetterAndCleared(4)));
setBySetterAndCleared(function (n) { return n * 3; });
console.log(attempt(() => callBySetterAndCleared(4)));
bySetterAndCleared = undefined;
console.log(attempt(() => callBySetterAndCleared(4)));

setBySetterAndClearedWithNull(function (n) { return n * 5; });
console.log(attempt(() => callBySetterAndClearedWithNull(4)));
setBySetterAndClearedWithNull(null);
console.log(attempt(() => callBySetterAndClearedWithNull(4)));

setOneOfTwoBySetter(function (n) { return n + 10; });
console.log(attempt(() => callOneOfTwoBySetter(4)));
setOneOfTwoBySetter(function (n) { return n + 20; });
console.log(attempt(() => callOneOfTwoBySetter(4)));

setSometimesANumberBySetter(function (n) { return n + 100; });
console.log(attempt(() => callSometimesANumberBySetter(4)));
setSometimesANumberBySetter(5);
console.log(attempt(() => callSometimesANumberBySetter(4)));

let sum = 0;
for (let i = 0; i < 1000; i++) sum += callBySetter(i);
console.log(sum);

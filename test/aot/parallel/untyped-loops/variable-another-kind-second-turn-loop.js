// A variable holds an object, a list, a text, undefined, null or a boolean when a loop begins and an integer from the second turn on. Each turn reads it and adds to a variable of the module or of the function around it.
// STATISTIC: LoopsSeparatedFromUnlikelyPaths >= 8
let out = "";
let total = 0;
let last = 0;
const table = [3, "x", 2.5, { valueOf: () => 9 }];

function storedInTheTurn(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    out += n + ",";
    n &= -1;
    out += n + ",";
  }
}
storedInTheTurn({ a: 1 }, 3);
out += "\n";

function declaredInTheHead(start, turns) {
  for (let n = start, turn = 0; turn < turns; turn++) {
    out += n + ",";
    n |= 0;
  }
}
declaredInTheHead([1], 3);
out += "\n";

function storedByACallbackBetweenTwoReadsInAList(start) {
  for (let n = start, turn = 0; turn < 2; turn++) {
    for (const each of [n, [0].map(() => (n &= -1))[0], n]) out += each + ",";
  }
}
storedByACallbackBetweenTwoReadsInAList({ a: 1 });
out += "\n";

function takenApartByAPattern(start) {
  for (let n = start, turn = 0; turn < 2; turn++) {
    const [first, second, third] = [n, [0].map(() => (n &= -1))[0], n];
    out += first + "," + second + "," + third + ",";
  }
}
takenApartByAPattern({ a: 1 });
out += "\n";

function readByIndex(start) {
  for (let n = start, turn = 0; turn < 2; turn++) {
    const made = [n, [0].map(() => (n |= 0))[0], n];
    out += made[0] + "," + made[2] + ",";
  }
}
readByIndex([1]);
out += "\n";

function storedByAnArrow(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    out += n + ",";
    (() => (n &= -1))();
    out += n + ",";
  }
}
storedByAnArrow({ a: 1 }, 3);
out += "\n";

function storedByADefault(start, turns) {
  for (let n = start, turn = 0; turn < turns; turn++) {
    out += n + ",";
    ((p = (n &= -1)) => p)();
    out += n + ",";
  }
}
storedByADefault("7", 3);
out += "\n";

function storedByAGetter(start, turns) {
  var n = start;
  for (var turn = 0; turn < turns; turn++) {
    out += n + ",";
    ({
      get x() {
        return (n &= -1);
      },
    }).x;
  }
}
storedByAGetter({ a: 1 }, 3);
out += "\n";

function copiedFromTurnToTurn(start) {
  let kept = start;
  for (const each of [0, 1, 2]) {
    let n = kept;
    out += n + ",";
    [0].forEach(() => {
      n &= -1;
    });
    out += n + ",";
    kept = n;
  }
}
copiedFromTurnToTurn({ a: 1 });
out += "\n";

function inALoopThatTestsLast(start, turns) {
  let n = start,
    turn = 0;
  do {
    out += n + ",";
    n &= -1;
  } while (++turn < turns);
}
inALoopThatTestsLast({ a: 1 }, 3);
out += "\n";

function inTheInnerOfTwoLoops(start, turns) {
  let n = start;
  for (let outer = 0; outer < 2; outer++) {
    for (let turn = 0; turn < turns; turn++) {
      out += n + ",";
      n &= -1;
      out += n + ",";
    }
  }
}
inTheInnerOfTwoLoops({ a: 1 }, 3);
out += "\n";

function addsToAVariableOfTheFunctionAroundIt(start, turns) {
  let text = "";
  function scene() {
    let n = start;
    for (let turn = 0; turn < turns; turn++) {
      text += n + ",";
      n &= -1;
      text += n + ",";
    }
  }
  scene();
  return text;
}
out += addsToAVariableOfTheFunctionAroundIt({ a: 1 }, 3) + "\n";

function sumsFromUndefined(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    total = total + (n | 0);
    n = (n & 7) + 1;
  }
}
sumsFromUndefined(undefined, 6);
out += total + "\n";

function sumsFromNull(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    total = total + (n | 0);
    n = (n & 7) + 1;
  }
}
sumsFromNull(null, 6);
out += total + "\n";

function sumsFromTrue(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    total = total + (n | 0);
    n = (n & 7) + 1;
  }
}
sumsFromTrue(true, 6);
out += total + "\n";

function keepsTheValueOfTheTurnBefore(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    last = n;
    n = (n | 0) + 1;
    total += typeof last === "number" ? last : 100;
  }
}
keepsTheValueOfTheTurnBefore({ a: 1 }, 6);
out += total + "," + last + "\n";

function readsATableByTheValueOfTheTurnBefore(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    last = n;
    n = n * 2;
    total += table[last & 3] ?? -1;
  }
}
readsATableByTheValueOfTheTurnBefore([1], 6);
out += total + "," + last + "\n";

console.log(out);

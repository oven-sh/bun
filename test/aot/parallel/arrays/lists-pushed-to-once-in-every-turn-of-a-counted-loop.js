const lines = [];
function show(name, list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const element = list[i];
    sum = (sum * 31 + (typeof element === "number" ? element * 2 : typeof element === "string" ? element.length + 1 : element === undefined ? 7 : element === null ? 11 : (element.id ?? element.length ?? 13) + 3)) % 1000003;
  }
  lines.push(name + " " + list.length + " " + sum + " " + String(list[0]).slice(0, 12) + " " + String(list[list.length - 1]).slice(0, 12) + " " + (list.length - 1 in list) + " " + (list.length in list));
}
const sizes = [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 64, 65, 1000];

function integers(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function fractions(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k + 0.5);
  return list;
}
function notNumbers(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k === 5 ? NaN : k / 2);
  return list;
}
function texts(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push("t" + k);
  return list;
}
function sameText(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push("same");
  return list;
}
function objects(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push({ id: k });
  return list;
}
function mixed(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k % 3 === 0 ? k : k % 3 === 1 ? "s" + k : null);
  return list;
}
function integersThenAFraction(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k === 9 ? 9.25 : k);
  return list;
}
function integersThenAText(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k === 9 ? "nine" : k);
  return list;
}
function fromOne(n) {
  const list = [];
  for (let k = 1; k <= n; k++) list.push(k);
  return list;
}
function fromFive(n) {
  const list = [];
  for (let k = 5; k < n; k++) list.push(k);
  return list;
}
function fromMinusThree(n) {
  const list = [];
  for (let k = -3; k < n; k++) list.push(k);
  return list;
}
function behindTwoElements(n) {
  const list = [-1, -2];
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function behindTwoElementsFromOne(n) {
  const list = ["a", "b"];
  for (let k = 1; k <= n; k++) list.push("c" + k);
  return list;
}
function eitherArmPushes(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k & 1) list.push(-k);
    else list.push(k * 2);
  }
  return list;
}
function whileLoop(n) {
  const list = [];
  let k = 0;
  while (k < n) {
    list.push(k * 3);
    k++;
  }
  return list;
}
function counterSteppedFirst(n) {
  const list = [];
  let k = 0;
  while (k < n) {
    k++;
    list.push(k);
  }
  return list;
}
function doWhile(n) {
  const list = [];
  let k = 0;
  do {
    list.push(k);
    k++;
  } while (k < n);
  return list;
}
function lengthOfPushUsed(n) {
  const list = [];
  let total = 0;
  for (let k = 0; k < n; k++) total += list.push(k);
  list.push(total);
  return list;
}
function looksAtItself(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k === 0 ? 1 : list[k - 1] + list.length);
  return list;
}
function double(x) {
  return x * 2;
}
function pushesWhatACallGives(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(double(k));
  return list;
}
function overAnotherList(source) {
  const list = [];
  for (let k = 0; k < source.length; k++) list.push(source[k] + 1);
  return list;
}
function overAnotherListByForOf(source) {
  const list = [];
  for (const element of source) list.push(element + 1);
  return list;
}
function twoLists(n) {
  const evens = [];
  const odds = [];
  for (let k = 0; k < n; k++) {
    evens.push(k * 2);
    odds.push(k * 2 + 1);
  }
  return evens.concat(odds);
}
function newListInEveryOuterTurn(n) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let k = 0; k < n; k++) row.push(i * 100 + k);
    rows.push(row.length + ":" + row.join("").length);
  }
  return rows;
}
function leftEarly(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k === 11) break;
  }
  list.push("end");
  return list;
}
function leftEarlyInFrontOfThePush(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k === 11) break;
    list.push(k);
  }
  list.push("end");
  return list;
}
function returnsFromTheLoop(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k === 6) return list;
  }
  return list;
}
function mayThrow(k) {
  if (k === 13) throw new Error("thirteen");
  return k;
}
function thrownOutOf(n) {
  const list = [];
  try {
    for (let k = 0; k < n; k++) list.push(mayThrow(k));
  } catch (error) {
    list.push(error.message);
  }
  return list;
}

function pushInTheTest(n) {
  const list = [];
  for (let k = 0; list.push(k) < n; k++);
  return list;
}
function pushInTheStep(n) {
  const list = [];
  for (let k = 0; k < n; list.push(k), k++);
  return list;
}
function someTurnsPush(n) {
  const list = [];
  for (let k = 0; k < n; k++) if (k % 3) list.push(k);
  return list;
}
function someTurnsGoOnEarly(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k % 4 === 2) continue;
    list.push(k);
  }
  return list;
}
function twoPushesATurn(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    list.push(-k);
  }
  return list;
}
function twoElementsAPush(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k, -k);
  return list;
}
function oneArmPushesTwice(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k === 3) list.push("again");
  }
  return list;
}
function newListInTheLoop(n) {
  let into = [];
  const first = into;
  for (let i = 0; i < n; i++) {
    if (i === 5) into = [];
    into.push(i * 2);
  }
  return first.concat(["|"], into);
}
function eitherOfTwoLists(n, flag) {
  const a = [];
  const b = [];
  const list = flag ? a : b;
  for (let k = 0; k < n; k++) list.push(k);
  a.push("a");
  b.push("b");
  return a.concat(b);
}
function caughtInTheLoop(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    try {
      list.push(mayThrow(k));
    } catch {}
  }
  return list;
}
function pushedToInFront(n) {
  const list = [];
  list.push("first");
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function pushedToInFrontSometimes(n) {
  const list = [];
  if (n & 1) list.push("odd");
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function madeOutsideTwoLoops(n) {
  const list = [];
  for (let i = 0; i < 3; i++) for (let k = 0; k < n; k++) list.push(i * 10 + k);
  return list;
}
function twoLoopsInARow(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k);
  for (let k = 0; k < n; k++) list.push(-k);
  return list;
}
function takesAway(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k % 5 === 4) list.pop();
  }
  return list;
}
function cutShort(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k === 6) list.length = 0;
    list.push(k);
  }
  return list;
}
function madeLonger(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k === 6) list.length = 20;
    list.push(k);
  }
  return list;
}
function storedBeyondTheEnd(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k === 2) list[10] = "ten";
    list.push(k);
  }
  return list;
}
function counterSteppedTwice(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k === 4) k++;
  }
  return list;
}
function counterByTwo(n) {
  const list = [];
  for (let k = 0; k < n; k += 2) list.push(k);
  return list;
}
function counterGoesDown(n) {
  const list = [];
  for (let k = n; k > 0; k--) list.push(k);
  return list;
}
function counterIsAFraction(n) {
  const list = [];
  for (let k = 0.5; k < n; k++) list.push(k);
  return list;
}
function counterStartsAtAnArgument(n, start) {
  const list = [];
  for (let k = start; k < n; k++) list.push(k);
  return list;
}
function pushesMore(list) {
  if (list.length === 3) list.push("more");
  return list.length;
}
function handedToACall(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    pushesMore(list);
  }
  return list;
}
let kept = null;
function pushesToWhatIsKept() {
  if (kept !== null && kept.length === 2) kept.push("kept");
  return 1;
}
function keptInFront(n) {
  const list = [];
  kept = list;
  for (let k = 0; k < n; k++) list.push(k + pushesToWhatIsKept());
  kept = null;
  return list;
}
function keptInTheLoop(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    if (k === 1) kept = list;
    list.push(k + pushesToWhatIsKept());
  }
  kept = null;
  return list;
}
function heldByAClosure(n) {
  const list = [];
  const again = () => {
    if (list.length === 4) list.push("closure");
  };
  for (let k = 0; k < n; k++) {
    list.push(k);
    again();
  }
  return list;
}
function pushesItself(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k === 2 ? list : k);
  return list;
}
function withAHole(n) {
  const list = [, 1];
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function madeWithALength(n) {
  const list = new Array(3);
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function aParameter(list, n) {
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
function* yieldsInTheLoop(n) {
  const list = [];
  for (let k = 0; k < n; k++) {
    list.push(k);
    if (k === 2) yield list.length;
  }
  yield list;
}
function* countsInTheTest() {
  const list = [];
  let turns = 0;
  for (let x = 0; turns++ < 16; x++) list.push(x + turns);
  yield list;
}
async function awaitsInTheLoop(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(await k);
  return list;
}
function labelled(n) {
  const list = [];
  outer: for (let i = 0; i < 3; i++) {
    for (let k = 0; k < n; k++) {
      if (k === 2 && i === 1) continue outer;
      list.push(k);
    }
  }
  return list;
}
function ownPush(n) {
  const list = [];
  list.push = function (x) {
    this[this.length] = x;
    this[this.length] = x;
    return this.length;
  };
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}

const byOneSize = [
  integers, fractions, notNumbers, texts, sameText, objects, mixed, integersThenAFraction, integersThenAText, fromOne, fromFive, fromMinusThree, behindTwoElements,
  behindTwoElementsFromOne, eitherArmPushes, whileLoop, counterSteppedFirst, doWhile, lengthOfPushUsed, looksAtItself, pushesWhatACallGives, twoLists, newListInEveryOuterTurn,
  leftEarly, leftEarlyInFrontOfThePush, returnsFromTheLoop, thrownOutOf, pushInTheTest, pushInTheStep, someTurnsPush, someTurnsGoOnEarly, twoPushesATurn, twoElementsAPush,
  oneArmPushesTwice, newListInTheLoop, caughtInTheLoop, pushedToInFront, pushedToInFrontSometimes, madeOutsideTwoLoops, twoLoopsInARow, takesAway, cutShort, madeLonger,
  storedBeyondTheEnd, counterSteppedTwice, counterByTwo, counterGoesDown, counterIsAFraction, handedToACall, keptInFront, keptInTheLoop, heldByAClosure, pushesItself, withAHole,
  madeWithALength, labelled, ownPush,
];
for (const make of byOneSize) for (const n of sizes) show(make.name + " " + n, make(n | 0));
for (const n of sizes) {
  show("overAnotherList " + n, overAnotherList(integers(n | 0)));
  show("overAnotherListByForOf " + n, overAnotherListByForOf(fractions(n | 0)));
  show("eitherOfTwoLists " + n, eitherOfTwoLists(n | 0, n & 1));
  show("counterStartsAtAnArgument " + n, counterStartsAtAnArgument(n | 0, n >> 1));
  show("aParameter " + n, aParameter([], n | 0));
  show("aParameter that holds something " + n, aParameter(["x", "y", "z"], n | 0));
  for (const step of yieldsInTheLoop(n | 0)) show("yieldsInTheLoop " + n, typeof step === "number" ? [step] : step);
}
for (const step of countsInTheTest()) show("countsInTheTest", step);

for (const n of [99999, 100000, 100001, 1048575, 1048576, 1048577, 1200000]) {
  show("integers " + n, integers(n | 0));
  show("fractions " + n, fractions(n | 0));
  show("sameText " + n, sameText(n | 0));
  show("fromOne " + n, fromOne(n | 0));
  show("behindTwoElements " + n, behindTwoElements(n | 0));
}
for (let round = 0; round < 3; round++) {
  show("objects 300000", objects(300000));
  show("texts 200000", texts(200000));
}
function boundedByAnything(n) {
  const list = [];
  for (let k = 0; k < n; k++) list.push(k);
  return list;
}
for (const n of [-1, -0, 0.5, 2.5, 7, NaN, -Infinity, "3", null, undefined, { valueOf: () => 4 }]) show("boundedByAnything " + String(n), boundedByAnything(n));

for (const n of sizes) show("awaitsInTheLoop " + n, await awaitsInTheLoop(n | 0));

console.log(lines.join("\n"));

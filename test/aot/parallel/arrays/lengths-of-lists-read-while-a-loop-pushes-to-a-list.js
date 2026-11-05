// A loop that pushes to one list may read the length of another once, in front of the loop, and test its bounds against that. It may not where the two can be the same list, or where anything in the loop can change the one it reads.
const say = (name, ...values) => console.log(name, values.map(value => JSON.stringify(value)).join(" "));

function copied(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) out.push(source[k] * 2);
  return out;
}
for (const source of [[], [1], [1, 2, 3], [1.5, 2.5], Array.from({ length: 5000 }, (_, k) => k)]) {
  const out = copied(source);
  say("copied", out.length, out[0], out[out.length - 1]);
}

const moduleList = [1, 2, 3, 4, 5, 6, 7, 8];
function copiedFromModule(i) {
  const out = [];
  for (let k = 0; k < moduleList.length; k++) out.push(moduleList[k]);
  return out[i & 7];
}
function copiedFromModuleAndReturned() {
  const out = [];
  for (let k = 0; k < moduleList.length; k++) out.push(moduleList[k]);
  return out;
}
for (let i = 0; i < 20; i++) say("from module", copiedFromModule(i), copiedFromModuleAndReturned().length);

function pushedToWhatIsMeasured(start, limit) {
  const out = start;
  const same = out;
  for (let k = 0; k < same.length && k < limit; k++) out.push(k);
  return out;
}
say("one list by two names", pushedToWhatIsMeasured([9], 5), pushedToWhatIsMeasured([], 5));

function pushInto(to, from, limit) {
  for (let k = 0; k < from.length && k < limit; k++) to.push(from[k]);
  return to.length;
}
const both = [1, 2];
say("one list as two parameters", pushInto(both, both, 6), both, pushInto([], [1, 2], 6));

function becomesTheMeasuredList(source) {
  let out = [];
  for (let k = 0; k < source.length && k < 10; k++) {
    out.push(source[k]);
    if (k === 1) out = source;
  }
  return [out.length, source.length];
}
say("the variable gets the measured list", becomesTheMeasuredList([1, 2, 3]));

const holder = { list: [] };
function throughAHolder(source) {
  const out = holder.list;
  holder.list = source;
  for (let k = 0; k < holder.list.length && k < 6; k++) out.push(k);
  return out.length;
}
say("through an object", throughAHolder([1, 2]));
const heldTwice = [1, 2];
holder.list = heldTwice;
say("through an object, same list", throughAHolder(heldTwice), heldTwice.length);

let shared;
function escapesInFront() {
  const out = [1, 2, 3];
  shared = out;
  for (let k = 0; k < shared.length && k < 6; k++) out.push(k);
  return out.length;
}
say("escapes in front of the loop", escapesInFront());
let handed = [];
function handedOnInTheLoop() {
  const out = [];
  for (let k = 0; k < handed.length + 3 && k < 6; k++) {
    out.push(k);
    handed = out;
  }
  return [out.length, handed.length];
}
say("handed on in the loop", handedOnInTheLoop());
let last = [1, 2, 3];
function theListOfTheCallBefore() {
  const out = [];
  for (let k = 0; k < last.length; k++) {
    out.push(last[k]);
    out.push(last[k]);
  }
  last = out;
  return out.length;
}
say("the list of the call before", theListOfTheCallBefore(), theListOfTheCallBefore(), theListOfTheCallBefore());

function popped(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    source.pop();
  }
  return out;
}
say("popped in the loop", popped([1, 2, 3, 4, 5, 6]));
function shortened(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    if (k === 2) source.length = 3;
  }
  return out;
}
say("shortened in the loop", shortened([1, 2, 3, 4, 5, 6]));
function grownByAStore(source) {
  const out = [];
  for (let k = 0; k < source.length && k < 8; k++) {
    out.push(source[k]);
    source[source.length] = k;
  }
  return [out, source.length];
}
say("grown by a store", grownByAStore([1, 2]));
function shifted(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    source.shift();
  }
  return out;
}
say("shifted", shifted([1, 2, 3, 4, 5, 6]));
function spliced(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    if (k === 1) source.splice(0, 3);
  }
  return out;
}
say("spliced", spliced([1, 2, 3, 4, 5, 6]));

function calledBack(source, change) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    change(source, k);
  }
  return out;
}
say("a callback shortens it", calledBack([1, 2, 3, 4, 5], (list, k) => { if (k === 1) list.length = 2; }));
say("a callback leaves it", calledBack([1, 2, 3], () => {}));
function textOfAnObject(source, object) {
  const out = [];
  for (let k = 0; k < source.length; k++) out.push("" + object);
  return out.length;
}
const shortList = [1, 2, 3, 4, 5];
say("toString shortens it", textOfAnObject(shortList, { toString() { shortList.pop(); return "x"; } }), shortList.length);
function throughAProxy(source) {
  const out = [];
  for (let k = 0; k < source.length && k < 4; k++) out.push(source[k]);
  return out;
}
say("a proxy", throughAProxy(new Proxy([1, 2], { get: (target, key) => (key === "length" ? 3 : target[key]) })));

// The length is read in front of the loop by the program itself, and the list changes before the loop begins.
function readThenShortened(source) {
  const length = source.length;
  source.pop();
  source.pop();
  const out = [];
  for (let k = 0; k < length; k++) out.push(source[k]);
  return out;
}
say("read, then shortened", readThenShortened([1, 2, 3, 4]));
function readThenLengthened(source) {
  const length = source.length;
  source.push(7);
  const out = [];
  for (let k = 0; k < length + 1; k++) out.push(source[k]);
  return out;
}
say("read, then lengthened", readThenLengthened([1, 2, 3]));
function readAndComparedAhead(source, limit) {
  const out = [];
  for (let k = 0; k < limit; k++) out.push(k < source.length ? source[k] : -1);
  return out;
}
say("the loop goes beyond the length", readAndComparedAhead([1, 2], 4));
function aheadOfTheStart(source) {
  const out = [];
  for (let k = -1; k < source.length; k++) out.push(source[k]);
  return out;
}
say("the position begins below zero", aheadOfTheStart([1, 2]));
function withHoles(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) out.push(source[k]);
  return out;
}
say("holes", withHoles([1, , 3]).length, withHoles([1, , 3])[1] === undefined);

function nested(source, turns) {
  const out = [];
  for (let turn = 0; turn < turns; turn++) {
    for (let k = 0; k < source.length; k++) out.push(source[k]);
    source.push(turn);
  }
  return [out, source.length];
}
say("the outer loop lengthens it", nested([1], 3));
function nestedAndNew(source, turns) {
  const lists = [];
  for (let turn = 0; turn < turns; turn++) {
    const out = [];
    for (let k = 0; k < source.length; k++) out.push(source[k] + turn);
    lists.push(out);
  }
  return lists;
}
say("a new list each turn", nestedAndNew([1, 2], 3));
function nestedAndNewAliased(turns) {
  let previous = [1];
  for (let turn = 0; turn < turns; turn++) {
    const out = [];
    for (let k = 0; k < previous.length; k++) {
      out.push(previous[k]);
      out.push(turn);
    }
    previous = out;
  }
  return previous;
}
say("each list is measured in the next turn", nestedAndNewAliased(3));
function fullAndGrown(source) {
  const out = [0, 0];
  out.length = 0;
  for (let k = 0; k < source.length; k++) out.push(source[k]);
  return out.length;
}
say("grows past its storage", fullAndGrown(Array.from({ length: 300 }, (_, k) => k)));
function* generated(source) {
  const out = [];
  for (let k = 0; k < source.length; k++) {
    out.push(source[k]);
    yield out.length;
  }
}
const listOfTheGenerator = [1, 2, 3, 4];
const walk = generated(listOfTheGenerator);
walk.next();
listOfTheGenerator.pop();
say("a generator's list changes while it waits", [...walk]);

// The list of the turn before is still at hand, and it is the one that is measured.
let keptByTheTurnBefore = [1];
function pushesToTheListOfTheTurnBefore(turns) {
  let previous = null;
  for (let turn = 0; turn < turns; turn++) {
    const out = [];
    const target = previous ?? out;
    for (let k = 0; k < keptByTheTurnBefore.length && k < 5; k++) target.push(k);
    keptByTheTurnBefore = out;
    previous = out;
  }
  return [keptByTheTurnBefore.length, previous.length];
}
say("pushes to the list of the turn before", pushesToTheListOfTheTurnBefore(3));
let keptEachTurn = [1];
function eachTurnKeepsItsList(turns) {
  for (let turn = 0; turn < turns; turn++) {
    const out = [];
    for (let k = 0; k < keptEachTurn.length; k++) {
      out.push(keptEachTurn[k]);
      out.push(turn);
    }
    keptEachTurn = out;
  }
  return keptEachTurn;
}
say("each turn keeps its list", eachTurnKeepsItsList(3));
function twoListsArePushedTo(measured, other) {
  const out = [];
  for (let k = 0; k < measured.length && k < 8; k++) {
    out.push(measured[k]);
    other.push(k);
  }
  return [out, measured.length, other.length];
}
const measuredAndPushedTo = [1, 2];
say("the second push goes to the measured list", twoListsArePushedTo(measuredAndPushedTo, measuredAndPushedTo), twoListsArePushedTo([1, 2], []));
function lengthIsAlsoAFraction(source) {
  const out = [];
  const length = source.length;
  const half = length * 0.5;
  for (let k = 0; k < length; k++) out.push(source[k] + half);
  return [out, length / 4];
}
say("the length is also used as a fraction", lengthIsAlsoAFraction([1, 2, 3]), lengthIsAlsoAFraction([]));
function storesIntoAnotherList(source, other) {
  let total = 0;
  for (let k = 0; k < source.length && k < 8; k++) {
    total += source[k];
    other[other.length] = k;
  }
  return [total, source.length];
}
const storedIntoAndMeasured = [1, 2];
say("a store lengthens the measured list", storesIntoAnotherList(storedIntoAndMeasured, storedIntoAndMeasured), storesIntoAnotherList([1, 2], []));

function copiedByForOf(source) {
  const out = [];
  for (const value of source) out.push(value);
  return out;
}
say("for-of", copiedByForOf([1, 2, 3]), copiedByForOf([]), copiedByForOf([1.5, , "x"]));
function storedByForOf(source, other) {
  let at = 0;
  for (const value of source) other[at++] = value;
  return [other, source.length];
}
say("for-of stores into another list", storedByForOf([1, 2, 3], []), storedByForOf([1, 2, 3], [9, 9, 9, 9]));
function walkedWhileItGrows(list) {
  let at = list.length;
  let turns = 0;
  for (const value of list) {
    if (turns++ > 5) break;
    list[at++] = value * 2;
  }
  return list;
}
say("for-of over a list that a store lengthens", walkedWhileItGrows([1, 2]));
function walkedWhileItIsPushedTo(list, other) {
  let turns = 0;
  for (const value of list) {
    if (turns++ > 5) break;
    other.push(value);
  }
  return [list.length, other.length];
}
const walkedAndPushedTo = [1, 2];
say("for-of over a list that is pushed to", walkedWhileItIsPushedTo(walkedAndPushedTo, walkedAndPushedTo), walkedWhileItIsPushedTo([1, 2], []));

// A loop leaves a generator that stands in an iteration. What the loop's getter resumes goes on at the next element.
import { inspect } from "node:util";

const pick = name => (process.argv.length < 0 ? "" : name);
const inputs = [[1, 2, 3], [], ["a"], [0.5, -0, NaN, undefined, null], [{ o: 1 }, [2], true, 4n], [9, , 7]];
let log = [];
let how = 0;

const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
const { next, return: finish, throw: raise } = engines;
function goOn() {
  for (let i = 0; i < 9; i++) {
    let r;
    try {
      r = i === how ? raise.call(this, new Error("t" + i)) : i === how - 9 ? finish.call(this, "r") : next.call(this, i);
    } catch (e) {
      log.push(e.message);
      break;
    }
    log.push(r.value, r.done);
    if (r.done) break;
  }
  return {};
}
function drive(name, run, prototype) {
  for (let turn = 0; turn < 60; turn++) {
    how = turn % 20;
    log = [];
    let r;
    try {
      r = run(inputs[turn % inputs.length], turn % 5);
    } catch (e) {
      r = e.message;
    }
    Object.setPrototypeOf(prototype, engines);
    if (turn < 12 || turn === 33 || turn === 59) console.log(name, turn, inspect(r), inspect(log, { depth: 3, breakLength: Infinity }));
  }
}

function* elements(input) {
  for (const x of input) yield x;
  yield "end";
}
console.log([() => elements(inputs[0])].map(make => make().next().value));
const ownElements = { get value() { Object.setPrototypeOf(elements.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveElements(input, at) { for (const v of elements(input)) { if (at-- <= 0 && ownElements.value) return v; } return "none"; }
drive("elements", leaveElements, elements.prototype);

function* indexes(input) {
  for (const i of input.keys()) yield i;
  yield "end";
}
console.log([() => indexes(inputs[0])].map(make => make().next().value));
const ownIndexes = { get value() { Object.setPrototypeOf(indexes.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveIndexes(input, at) { for (const v of indexes(input)) { if (at-- <= 0 && ownIndexes.value) return v; } return "none"; }
drive("indexes", leaveIndexes, indexes.prototype);

function* pairs(input) {
  for (const [i, x] of input.entries()) yield [i, x];
  yield "end";
}
console.log([() => pairs(inputs[0])].map(make => make().next().value));
const ownPairs = { get value() { Object.setPrototypeOf(pairs.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leavePairs(input, at) { for (const v of pairs(input)) { if (at-- <= 0 && ownPairs.value) return v; } return "none"; }
drive("pairs", leavePairs, pairs.prototype);

function* literal(input) {
  const mine = [1, 2, 3, 4];
  for (let i = 0; i < 8; i += 4) for (const x of mine) yield x + i;
  yield "end";
}
console.log([() => literal(inputs[0])].map(make => make().next().value));
const ownLiteral = { get value() { Object.setPrototypeOf(literal.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveLiteral(input, at) { for (const v of literal(input)) { if (at-- <= 0 && ownLiteral.value) return v; } return "none"; }
drive("literal", leaveLiteral, literal.prototype);

function* letters(input) {
  for (const c of "a\u{1F600}b\u00e9" + input.length) yield c;
  yield "end";
}
console.log([() => letters(inputs[0])].map(make => make().next().value));
const ownLetters = { get value() { Object.setPrototypeOf(letters.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveLetters(input, at) { for (const v of letters(input)) { if (at-- <= 0 && ownLetters.value) return v; } return "none"; }
drive("letters", leaveLetters, letters.prototype);

function* keysOfMap(input) {
  const map = new Map(input.map((x, i) => [i, x]));
  for (const k of map.keys()) {
    if (k === 1) map.delete(2);
    yield k;
  }
  yield "end";
}
console.log([() => keysOfMap(inputs[0])].map(make => make().next().value));
const ownKeysOfMap = { get value() { Object.setPrototypeOf(keysOfMap.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveKeysOfMap(input, at) { for (const v of keysOfMap(input)) { if (at-- <= 0 && ownKeysOfMap.value) return v; } return "none"; }
drive("keysOfMap", leaveKeysOfMap, keysOfMap.prototype);

function* valuesOfMap(input) {
  const map = new Map(input.map((x, i) => [i, x]));
  for (const x of map.values()) yield x;
  yield "end";
}
console.log([() => valuesOfMap(inputs[0])].map(make => make().next().value));
const ownValuesOfMap = { get value() { Object.setPrototypeOf(valuesOfMap.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveValuesOfMap(input, at) { for (const v of valuesOfMap(input)) { if (at-- <= 0 && ownValuesOfMap.value) return v; } return "none"; }
drive("valuesOfMap", leaveValuesOfMap, valuesOfMap.prototype);

function* entriesOfMap(input) {
  const map = new Map(input.map((x, i) => [i, x]));
  for (const [k, x] of map) {
    if (k === 0) map.set(99, "late");
    yield [k, x];
  }
  yield "end";
}
console.log([() => entriesOfMap(inputs[0])].map(make => make().next().value));
const ownEntriesOfMap = { get value() { Object.setPrototypeOf(entriesOfMap.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveEntriesOfMap(input, at) { for (const v of entriesOfMap(input)) { if (at-- <= 0 && ownEntriesOfMap.value) return v; } return "none"; }
drive("entriesOfMap", leaveEntriesOfMap, entriesOfMap.prototype);

function* elementsOfSet(input) {
  const set = new Set(input);
  for (const x of set) {
    if (set.size < 4) set.add("more");
    yield x;
  }
  yield "end";
}
console.log([() => elementsOfSet(inputs[0])].map(make => make().next().value));
const ownElementsOfSet = { get value() { Object.setPrototypeOf(elementsOfSet.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveElementsOfSet(input, at) { for (const v of elementsOfSet(input)) { if (at-- <= 0 && ownElementsOfSet.value) return v; } return "none"; }
drive("elementsOfSet", leaveElementsOfSet, elementsOfSet.prototype);

function* bytes(input) {
  const bytes = new Uint8Array(input.length + 2).fill(7);
  bytes[1] = input.length;
  for (const b of bytes) yield b;
  yield "end";
}
console.log([() => bytes(inputs[0])].map(make => make().next().value));
const ownBytes = { get value() { Object.setPrototypeOf(bytes.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveBytes(input, at) { for (const v of bytes(input)) { if (at-- <= 0 && ownBytes.value) return v; } return "none"; }
drive("bytes", leaveBytes, bytes.prototype);

function* doubles(input) {
  const numbers = Float64Array.of(0.5, -0, NaN, input.length);
  for (const n of numbers) yield n;
  yield "end";
}
console.log([() => doubles(inputs[0])].map(make => make().next().value));
const ownDoubles = { get value() { Object.setPrototypeOf(doubles.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveDoubles(input, at) { for (const v of doubles(input)) { if (at-- <= 0 && ownDoubles.value) return v; } return "none"; }
drive("doubles", leaveDoubles, doubles.prototype);

function* growing(input) {
  const mine = [...input];
  for (const x of mine) {
    if (mine.length < 5) mine.push(mine.length);
    yield x;
  }
  yield "end";
}
console.log([() => growing(inputs[0])].map(make => make().next().value));
const ownGrowing = { get value() { Object.setPrototypeOf(growing.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveGrowing(input, at) { for (const v of growing(input)) { if (at-- <= 0 && ownGrowing.value) return v; } return "none"; }
drive("growing", leaveGrowing, growing.prototype);

function* shrinking(input) {
  const mine = [...input, 1, 2, 3];
  for (const x of mine) {
    mine.length--;
    yield x;
  }
  yield "end";
}
console.log([() => shrinking(inputs[0])].map(make => make().next().value));
const ownShrinking = { get value() { Object.setPrototypeOf(shrinking.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveShrinking(input, at) { for (const v of shrinking(input)) { if (at-- <= 0 && ownShrinking.value) return v; } return "none"; }
drive("shrinking", leaveShrinking, shrinking.prototype);

function* delegated(input) {
  yield* [input.length, 1.5, "t"];
  yield* input;
  yield "end";
}
console.log([() => delegated(inputs[0])].map(make => make().next().value));
const ownDelegated = { get value() { Object.setPrototypeOf(delegated.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveDelegated(input, at) { for (const v of delegated(input)) { if (at-- <= 0 && ownDelegated.value) return v; } return "none"; }
drive("delegated", leaveDelegated, delegated.prototype);

function* nested(input) {
  for (const x of input) for (const y of [x, input.length]) yield [x, y];
  yield "end";
}
console.log([() => nested(inputs[0])].map(make => make().next().value));
const ownNested = { get value() { Object.setPrototypeOf(nested.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveNested(input, at) { for (const v of nested(input)) { if (at-- <= 0 && ownNested.value) return v; } return "none"; }
drive("nested", leaveNested, nested.prototype);

function* names(input) {
  for (const k in { a: 1, b: input, c: 3 }) yield k;
  yield "end";
}
console.log([() => names(inputs[0])].map(make => make().next().value));
const ownNames = { get value() { Object.setPrototypeOf(names.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveNames(input, at) { for (const v of names(input)) { if (at-- <= 0 && ownNames.value) return v; } return "none"; }
drive("names", leaveNames, names.prototype);

function* holes(input) {
  for (const x of [input.length, , 3, , null]) yield x;
  yield "end";
}
console.log([() => holes(inputs[0])].map(make => make().next().value));
const ownHoles = { get value() { Object.setPrototypeOf(holes.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveHoles(input, at) { for (const v of holes(input)) { if (at-- <= 0 && ownHoles.value) return v; } return "none"; }
drive("holes", leaveHoles, holes.prototype);

function* patterns(input) {
  for (const [a, b = "none"] of [[1, 2], [3], input]) yield [a, b];
  yield "end";
}
console.log([() => patterns(inputs[0])].map(make => make().next().value));
const ownPatterns = { get value() { Object.setPrototypeOf(patterns.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leavePatterns(input, at) { for (const v of patterns(input)) { if (at-- <= 0 && ownPatterns.value) return v; } return "none"; }
drive("patterns", leavePatterns, patterns.prototype);

function* counted(input) {
  let last = 0;
  for (const x of input) {
    last = yield [x, last];
  }
  yield "end";
}
console.log([() => counted(inputs[0])].map(make => make().next().value));
const ownCounted = { get value() { Object.setPrototypeOf(counted.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveCounted(input, at) { for (const v of counted(input)) { if (at-- <= 0 && ownCounted.value) return v; } return "none"; }
drive("counted", leaveCounted, counted.prototype);

function* underTry(input) {
  try {
    for (const x of input) {
      try {
        yield x;
      } finally {
        log.push("f");
      }
    }
  } catch (e) {
    yield e.message;
  }
  yield "end";
}
console.log([() => underTry(inputs[0])].map(make => make().next().value));
const ownUnderTry = { get value() { Object.setPrototypeOf(underTry.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveUnderTry(input, at) { for (const v of underTry(input)) { if (at-- <= 0 && ownUnderTry.value) return v; } return "none"; }
drive("underTry", leaveUnderTry, underTry.prototype);

// Spreads and array patterns over plain arrays stay out of C++. Every other source gives what bun run gives.
import vm from "node:vm";

const count = globalThis.aotOperationCount ?? (() => 0);

function describeElements(list) {
  let description = list.length + ":";
  for (let i = 0; i < list.length; i++) description += " " + (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole");
  return description;
}
function makeArray(length, valueAt) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(valueAt(i));
  return list;
}
function copyOf(a) { return [...a]; }
function copyBetween(a, b) { return [0, ...a, 1, ...b]; }
function copyAfterText(a, b) { return ["start", ...a, "end", ...b]; }
function firstThree(a) {
  const [x, y, z] = a;
  return [x, y, z];
}
function printCase(name, a, b) {
  console.log(name, "|", describeElements(copyOf(a)), "|", describeElements(copyBetween(a, b)), "|", describeElements(firstThree(a)));
}

const integers = makeArray(5, i => i);
const doubles = makeArray(5, i => i + 0.5);
const strings = makeArray(5, i => "s" + i);
const integers64 = makeArray(64, i => i);
const doubles64 = makeArray(64, i => i + 0.25);
const strings64 = makeArray(64, i => "t" + i);
const integers65 = makeArray(65, i => i);
const doubles65 = makeArray(65, i => i + 0.25);
const strings65 = makeArray(65, i => "u" + i);
const shortList = makeArray(2, i => i + 0.5);
const literalIntegers = [1, 2, 3];
const literalDoubles = [1.5, 2.5, 3.5];
const literalStrings = ["a", "b", "c"];

printCase("integers", integers, doubles);
printCase("doubles", doubles, strings);
printCase("strings", strings, integers);
printCase("integer holes", [1, , 3], integers);
printCase("double holes", [1.5, , 3.5], doubles);
printCase("string holes", ["a", , "c"], strings);
printCase("empty", [], []);
printCase("integers 64", integers64, integers65);
printCase("doubles 64", doubles64, doubles65);
printCase("strings 64", strings64, strings65);
printCase("integers 65", integers65, integers64);
printCase("doubles 65", doubles65, doubles64);
printCase("strings 65", strings65, strings64);
printCase("short", shortList, shortList);
printCase("literal integers", literalIntegers, literalDoubles);
printCase("literal doubles", literalDoubles, literalStrings);
printCase("literal strings", literalStrings, literalIntegers);
printCase("negative zero", [-0, 1.5], [-0, 2.5]);
printCase("set", new Set([1, "two", 3.5]), new Set());
printCase("string", "héllo", "ab");
printCase("iterable object", { *[Symbol.iterator]() { yield 1; yield "two"; } }, []);
printCase("generator", (function* () { yield 1; yield 2.5; yield "three"; })(), (function* () { yield 4; })());

const plainSources = [integers, doubles, strings, integers64, doubles64, strings64, shortList];
let appendsBefore = count("operationAOTAppendSpread");
let readsBefore = count("operationAOTReadBatchedElements");
let total = 0;
for (let round = 0; round < 1000; round++) {
  for (const source of plainSources) {
    total += copyAfterText(source, source).length;
    const [x, y, z] = source;
    if (x !== source[0] || y !== source[1] || z !== source[2]) total = -1;
  }
}
console.log("copied", total, count("operationAOTAppendSpread") === appendsBefore, count("operationAOTReadBatchedElements") === readsBefore);

class Rows extends Array {}
const subclassInstance = new Rows();
subclassInstance.push(1, 2, 3);
printCase("subclass instance", subclassInstance, subclassInstance);

const ownIterator = [1, 2, 3];
ownIterator[Symbol.iterator] = function* () { yield "own"; };
printCase("own iterator", ownIterator, ownIterator);

const replacedPrototype = [1, 2, 3];
Object.setPrototypeOf(replacedPrototype, { *[Symbol.iterator]() { yield "prototype"; } });
printCase("replaced prototype", replacedPrototype, replacedPrototype);

const frozen = Object.freeze([1, 2, 3]);
printCase("frozen", frozen, frozen);
console.log("frozen copy", Object.isFrozen(copyOf(frozen)));

const otherRealm = vm.runInNewContext("[1, 2.5, 'three']");
printCase("other realm", otherRealm, otherRealm);
console.log("other realm copy", copyOf(otherRealm) instanceof Array);

try {
  copyOf(null);
  console.log("null spread did not throw");
} catch (error) {
  console.log("null spread", error instanceof TypeError);
}

let halfBuilt;
const throwsInNext = {
  [Symbol.iterator]() {
    let step = 0;
    return {
      next() {
        if (step++ === 1) throw new RangeError("next failed");
        return { done: false, value: step };
      },
    };
  },
};
try {
  halfBuilt = [1, ...throwsInNext, 2];
} catch (error) {
  console.log("throwing next", error instanceof RangeError, halfBuilt === undefined);
}

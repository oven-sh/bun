// The exports object of a compiled CommonJS module has the keys, the key order, the descriptors and the prototype that plain Bun gives it, whichever way its names are stored or defined.
const { describe, show } = require("../describe-object.cjs");

function probe(label, object, names) {
  console.log(`${label}:`);
  for (const name of names) console.log(`  ${name} ${show(object[name])} | in ${name in object} own ${Object.hasOwn(object, name)} descriptor ${show(Object.getOwnPropertyDescriptor(object, name))}`);
}

function print(label, lines) {
  console.log(`${label}:`);
  for (const line of lines) console.log(`  ${line}`);
}

function walkWithBun(label, object) {
  console.log(`${label}, printed:`, object);
  try {
    console.log(`${label}, cloned:`, JSON.stringify(structuredClone(object)));
  } catch (error) {
    console.log(`${label}, cloned: threw`, error.name);
  }
  console.log(`${label}, compared with a copy:`, Bun.deepEquals(object, { ...object }), Bun.deepEquals({ ...object }, object), Bun.deepEquals(object, { ...object }, true));
}

describe("compiled by TypeScript", require("./typescript-output.cjs"));
walkWithBun("compiled by TypeScript", require("./typescript-output.cjs"));

const outOfOrder = require("./stored-out-of-order.cjs");
describe("stored in another order than written", outOfOrder);
console.log("read by name:", show([outOfOrder.a, outOfOrder.b, outOfOrder.c, outOfOrder.x, outOfOrder.y, outOfOrder.z, outOfOrder.chainA, outOfOrder.chainB, outOfOrder.chainC, outOfOrder.counted, outOfOrder.appended, outOfOrder.afterKey, outOfOrder.inHoisted, outOfOrder.afterAwait]));

const conditional = require("./stored-conditionally.cjs");
describe("stored on some paths only", conditional);
console.log("read by name:", show([conditional.never, conditional.alsoNever, conditional.inEmptyLoop, conditional.inLoopThatNeverRuns, conditional.afterThrow, conditional.behindAnd, conditional.absentAnd, conditional.caseA, conditional.caseDefault, conditional.afterBreak, conditional.neverDefined, conditional.afterReturn, conditional.always, conditional.storedOrDefined, conditional.storedOrGetter]));
probe("in the text but never stored", conditional, ["never", "alsoNever", "inEmptyLoop", "inLoopThatNeverRuns", "afterThrow", "behindAnd", "absentAnd", "caseA", "caseDefault", "afterBreak", "neverDefined", "afterReturn"]);
walkWithBun("stored on some paths only", conditional);
conditional.never = "stored by another module";
conditional.neverDefined = "stored by another module";
Object.defineProperty(conditional, "afterReturn", { value: "defined by another module" });
describe("after another module stored some of them", conditional);

const late = require("./stored-by-functions.cjs");
describe("before its functions run", late);
late.fill();
describe("after the function ran", late);
late.fill();
late.storeWrittenSecond();
late.storeWrittenFirst();
late.storeThroughAlias();
late.storeByName("second", "stored by a computed name");
late.storeByName("notInTheText", "stored by a computed name");
late.define();
describe("after the other functions ran", late);
console.log("removed:", late.remove());
late.storeByName("neverStored", "stored by a computed name");
late.fill();
describe("after the deletions", late);

describe("through module.exports", require("./through-module-exports.cjs"));

const odd = require("./odd-names.cjs");
describe("odd names", odd);
console.log("read by name:", show([odd.a, odd[0], odd[3], odd["1.5"], odd.__proto__, odd.constructor, odd.length, odd.then, odd.ascii, odd.inherited, odd[""], odd.hasOwnProperty]));
console.log("odd names, printed:", odd);

const definedPath = require.resolve("./defined-properties.cjs");
const integrityLevels = [
  ["defined", object => object],
  ["defined, then made not extensible", Object.preventExtensions],
  ["defined, then sealed", Object.seal],
  ["defined, then frozen", Object.freeze],
];
for (const [label, apply] of integrityLevels) {
  delete require.cache[definedPath];
  const defined = apply(require("./defined-properties.cjs"));
  describe(label, defined);
  console.log(`${label}, printed:`, defined);
  print(`${label}: changes`, defined.change());
  describe(`${label}: after the changes`, defined);
  console.log(`${label}: after the changes, printed:`, defined);
}

describe("nothing stored", require("./nothing-stored.cjs"));

const many = require("./many-names.cjs");
describe("many names", many);
console.log("read by name:", show([many.__esModule, many.a0, many.a149, many.a150, many.a299, many.g0, many.g99, many.c49, many.h9, many.n0, many.n3633, many.n3634, many.n3799, many.lastGetter, many.lastHidden, many.last, many.n3800]));
print("many names: deleted and stored again", many.reorder());

late.fillLater().then(lastKeys => {
  console.log("after the awaits:", lastKeys, outOfOrder.afterAwait, Object.keys(outOfOrder).slice(-2).join());
});

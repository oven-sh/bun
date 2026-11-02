// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/commonjs/exports-object-through-this-and-args
// STATISTIC: SourceFilesInferred = 10

// FILE: parallel/commonjs/exports-object-through-this-and-args/main.cjs
// At the top of a CommonJS module `this` and `arguments[0]` are the exports object, in sloppy and in strict code, in arrow functions and in the entry point, and a variable or parameter that is only called `exports` is not.
const { describe } = require("../../../fixtures/commonjs/describe-object.cjs");
const thisStrict = require("./this-strict.cjs");
const thisSloppy = require("./this-sloppy.cjs");
const thisInArrows = require("./this-in-arrows.cjs");
const argumentsSloppy = require("./arguments-sloppy.cjs");
const argumentsStrict = require("./arguments-strict.cjs");
const redeclaredVariable = require("./redeclared-variable.cjs");
const shadowedByParameters = require("./shadowed-by-parameters.cjs");
const helpersReadFromThis = require("./helpers-read-from-this.cjs");
describe("this-strict", thisStrict);
describe("this-sloppy", thisSloppy);
describe("this-in-arrows", thisInArrows);
describe("arguments-sloppy", argumentsSloppy);
describe("arguments-strict", argumentsStrict);
describe("redeclared-variable", redeclaredVariable);
describe("shadowed-by-parameters", shadowedByParameters);
describe("helpers-read-from-this", helpersReadFromThis);

console.log(thisStrict.viaThis, thisStrict.viaExports, thisStrict.same, thisStrict.inFunction, thisStrict.storedByText, thisStrict.fromIncrement, thisStrict.neverCreated, thisStrict.removed, thisStrict.readOnly, thisStrict.getterOnly, thisStrict.tooLate, thisStrict.receiver() === thisStrict);
console.log(thisSloppy.viaThis, thisSloppy.viaExports, thisSloppy.first, thisSloppy.second, thisSloppy.later, thisSloppy.lastOfLoop, thisSloppy.lastKeyOfLoop, thisSloppy.readOnly, thisSloppy.getterOnly, thisSloppy.viaReceiver, thisSloppy.filledByFunction, thisSloppy.readInWith, thisSloppy.tooLate, thisSloppy.fill() === thisSloppy);
thisStrict.storedByMain = 1;
thisSloppy.storedByMain = 1;
console.log("storedByMain" in thisStrict, "storedByMain" in thisSloppy);

console.log(thisInArrows.first, thisInArrows.second, thisInArrows.fromArrow, thisInArrows.fromCalledArrow, thisInArrows.stored(), thisInArrows.beforeAwait, thisInArrows.afterAwait, thisInArrows.filledLater);
console.log(thisInArrows.set("storedByMain", 1) === thisInArrows, thisInArrows.storedByMain, thisInArrows.fill(), thisInArrows.filledLater);
const { set } = thisInArrows;
console.log(set.call({}, "first", "stored through the arrow alone") === thisInArrows, thisInArrows.first);

console.log(argumentsSloppy.viaArguments, argumentsSloppy.createdThroughArguments, argumentsSloppy.viaModuleArgument, argumentsSloppy.viaApply, argumentsSloppy.viaSpread, argumentsSloppy.viaComputedIndex, argumentsSloppy.afterReplacing, argumentsSloppy.afterRestoring, argumentsSloppy.onOtherModule, argumentsSloppy.afterRestoringModule, argumentsSloppy.storedFunction());
console.log(argumentsStrict.viaArguments, argumentsStrict.createdThroughArguments, argumentsStrict.viaModuleArgument, argumentsStrict.viaApply, argumentsStrict.viaSpread, argumentsStrict.viaPattern, argumentsStrict.afterReplacing, argumentsStrict.afterReplacingModule, argumentsStrict.replaced, argumentsStrict.other, argumentsStrict.storedFunction());
console.log(redeclaredVariable.viaRedeclared, redeclaredVariable.viaModule, redeclaredVariable.viaThis, redeclaredVariable.viaArguments, redeclaredVariable.neverMade, redeclaredVariable.afterStoringItself, redeclaredVariable.read());
console.log(shadowedByParameters.onOther, shadowedByParameters.inBlock, shadowedByParameters.inArrow, shadowedByParameters.holdsTheExportsObject, shadowedByParameters.alsoHoldsTheExportsObject, shadowedByParameters.calledAgainWithoutAnObject, shadowedByParameters.own);
console.log(helpersReadFromThis.__esModule, helpersReadFromThis.value === Object.keys(thisStrict).join(), helpersReadFromThis.starredBy, helpersReadFromThis.starredNames, typeof helpersReadFromThis.__exportStar, helpersReadFromThis.__importStar);

this.viaThis = 1;
exports.viaExports = 2;
(() => { this.viaArrow = module.exports.viaModule = 3; })();
describe("the entry point", module.exports);
console.log(this === exports, this === module.exports, this.viaExports, exports.viaThis, exports.viaArrow);
queueMicrotask(() => describe("this-in-arrows after its await", thisInArrows));

// FILE: fixtures/commonjs/describe-object.cjs
// Prints everything a program can observe about the own properties of an object, for the programs about the exports object of a CommonJS module.
function show(value) {
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? `[${value.map(show).join()}]` : `{${Object.keys(value).join()}}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const showKeys = keys => keys.map(String).join();
const showProperties = copy => Reflect.ownKeys(copy).map(key => `${String(key)}=${show(copy[key])}`).join();
const showForm = descriptor => `${descriptor.writable === undefined ? "-" : descriptor.writable ? "w" : "_"}${descriptor.enumerable ? "e" : "_"}${descriptor.configurable ? "c" : "_"}`;

function listWithForIn(object) {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
}

function showDescriptors(object) {
  const descriptors = Object.getOwnPropertyDescriptors(object);
  return Reflect.ownKeys(descriptors).map(key => `${String(key)} ${showForm(descriptors[key])}`).join();
}

function copyWithoutFirstKey(object) {
  const [first] = Object.keys(object);
  const { [first]: excluded, ...rest } = object;
  return showProperties(rest);
}

// A proxy without traps asks the object itself, whatever the compiler knows about the object.
function observeThroughProxy(object) {
  const proxy = new Proxy(object, {});
  return `${Object.keys(proxy).join()} | ${showKeys(Reflect.ownKeys(proxy))} | ${showProperties({ ...proxy })}`;
}

function compareWithCopy(object) {
  const copy = { ...object };
  return [Bun.deepEquals(object, copy), Bun.deepEquals(copy, object), Bun.deepEquals(object, copy, true), Bun.deepEquals(copy, object, true)].join(" ");
}

// A function or an accessor that is only created when somebody asks for it is the same object for everybody who asks.
function answersAlike(object, key, descriptor) {
  if ("value" in descriptor) return Object.is(object[key], descriptor.value) && Object.is(Reflect.get(object, key), descriptor.value);
  const again = Object.getOwnPropertyDescriptor(object, key);
  const getter = Object.prototype.__lookupGetter__.call(object, key);
  const setter = Object.prototype.__lookupSetter__.call(object, key);
  return again.get === descriptor.get && again.set === descriptor.set && getter === descriptor.get && setter === descriptor.set;
}

function describeProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  const held = "value" in descriptor ? show(descriptor.value) : `get ${show(descriptor.get)} set ${show(descriptor.set)}`;
  const isFound = key in object && Reflect.has(object, key);
  const isOwn = Object.prototype.hasOwnProperty.call(object, key) && Object.hasOwn(object, key);
  const isListed = Object.prototype.propertyIsEnumerable.call(object, key);
  return `${showForm(descriptor)} ${held} | in ${isFound} own ${isOwn} listed ${isListed} alike ${answersAlike(object, key, descriptor)}`;
}

const lists = [
  ["keys", object => Object.keys(object).join()],
  ["names", object => Object.getOwnPropertyNames(object).join()],
  ["symbols", object => showKeys(Object.getOwnPropertySymbols(object))],
  ["own keys", object => showKeys(Reflect.ownKeys(object))],
  ["for-in", listWithForIn],
  ["entries", object => Object.entries(object).map(([key, value]) => `${key}=${show(value)}`).join()],
  ["values", object => Object.values(object).map(show).join()],
];

// Each of these goes through all the properties. The last four are functions of Bun, which do so in native code.
const walks = [
  ["descriptors", showDescriptors],
  ["json", object => JSON.stringify(object)],
  ["json with a replacer", object => JSON.stringify(object, (key, value) => value)],
  ["spread", object => showProperties({ ...object })],
  ["assign", object => showProperties(Object.assign({}, object))],
  ["rest", copyWithoutFirstKey],
  ["proxy", observeThroughProxy],
  ["state", object => [Object.isExtensible(object), Object.isSealed(object), Object.isFrozen(object), Object.getPrototypeOf(object) === Object.prototype, Object.prototype.toString.call(object)].join(" ")],
  ["Bun.inspect", object => Bun.inspect(object, { depth: 1, compact: true })],
  ["Bun.deepEquals", compareWithCopy],
  ["structuredClone", object => showProperties(structuredClone(object))],
  ["URLSearchParams", object => Array.from(new URLSearchParams(object).keys()).join()],
];

// An observation that throws is an answer too, and the observations after it are still made.
function printAnswer(name, observe, object, key) {
  let answer;
  try {
    answer = observe(object, key);
  } catch (error) {
    answer = `threw ${error instanceof Error ? error.name : show(error)}`;
  }
  console.log(`  ${name} ${answer}`);
}

function describe(label, object) {
  console.log(`${label}:`);
  for (const [name, observe] of lists) printAnswer(name, observe, object);
  for (const key of Reflect.ownKeys(object)) printAnswer(String(key), describeProperty, object, key);
  for (const [name, observe] of walks) printAnswer(name, observe, object);
}

module.exports = { describe, show };

// FILE: parallel/commonjs/exports-object-through-this-and-args/arguments-sloppy.cjs
arguments[0].viaArguments = 1;
exports.viaExports = 2;
exports.count = arguments.length;
exports.same = arguments[0] === exports && arguments[2] === module && arguments[1] === require;

arguments[0].createdThroughArguments = "created";
exports.createdThroughArguments += ", then stored";
arguments[2].exports.viaModuleArgument = 3;
arguments[0].storedFunction = function () { return this === exports; };
exports.resultOfStoredFunction = exports.storedFunction();
(function (object) { object.viaApply = arguments.length; }).apply(null, arguments);
((object, ...others) => { object.viaSpread = others.length; })(...arguments);
const held = arguments;
held[exports.count - 5].viaComputedIndex = 4;
exports.inArrow = (() => arguments[0])() === exports;
exports.inFunction = (function () { return arguments[0]; })();
exports.copies = [Array.prototype.slice.call(arguments)[0] === exports, Array.from(arguments)[0] === exports, Object.values(arguments)[0] === exports];

arguments[0] = { replaced: true };
exports.afterReplacing = 3;
module.exports.mapped = exports !== module.exports;
module.exports.keysOfReplacement = Object.keys(exports).join();
arguments[0] = module.exports;
exports.afterRestoring = 5;

const ownModule = module;
arguments[2] = { exports: { other: true } };
module.exports.onOtherModule = 6;
ownModule.exports.keysOfOtherModule = Object.keys(module.exports).join();
arguments[2] = ownModule;
module.exports.afterRestoringModule = 7;

// FILE: parallel/commonjs/exports-object-through-this-and-args/arguments-strict.cjs
"use strict";
arguments[0].viaArguments = 1;
exports.viaExports = 2;
exports.same = arguments[0] === exports;
exports.count = arguments.length;
exports.sameAsThis = arguments[0] === this && (() => arguments[0] === this)();

arguments[0].createdThroughArguments = "created";
exports.createdThroughArguments += ", then stored";
arguments[2].exports.viaModuleArgument = 3;
arguments[0].storedFunction = function () { return this === exports; };
exports.resultOfStoredFunction = exports.storedFunction();
(function (object) { object.viaApply = arguments.length; }).apply(undefined, arguments);
((object, ...others) => { object.viaSpread = others.length; })(...arguments);
const [first, , third] = arguments;
first.viaPattern = third.exports === first;

arguments[0] = { replaced: true };
exports.afterReplacing = 3;
exports.mapped = exports !== module.exports;
exports.keysOfReplacement = Object.keys(arguments[0]).join();
arguments[2] = { exports: { other: true } };
module.exports.afterReplacingModule = 4;
exports.keysOfOtherModule = Object.keys(arguments[2].exports).join();

// FILE: parallel/commonjs/exports-object-through-this-and-args/helpers-read-from-this.cjs
"use strict";
exports.__exportStar = function (m, exports) {
    exports.starredBy = "the helper found on this";
    exports.starredNames = Object.keys(m).length;
};
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.value = void 0;
const strict_1 = __importDefault(require("./this-strict.cjs"));
exports.value = Object.keys(strict_1.default).join();
const sloppy = __importStar(require("./this-sloppy.cjs"));
exports.namesOfStar = Object.keys(sloppy).join();
exports.readThroughStar = [sloppy.viaThis, sloppy.readOnly, sloppy.getterOnly, sloppy.tooLate, sloppy.default === require("./this-sloppy.cjs")];
__exportStar(require("./this-in-arrows.cjs"), exports);
exports.whereTheHelpersCameFrom = [__exportStar === this.__exportStar, typeof this.__importStar, typeof this.__importDefault, typeof this.__createBinding];

// FILE: parallel/commonjs/exports-object-through-this-and-args/redeclared-variable.cjs
var exports;
exports.viaRedeclared = 1;
var module;
module.exports.viaModule = 2;
exports.same = exports === module.exports;

this.viaThis = 3;
arguments[0].viaArguments = 4;
exports.sameAsTheOthers = exports === this && exports === arguments[0] && module === arguments[2];
if (typeof exports === "undefined") var exports = { neverMade: true };
exports.afterTheUntakenStore = 5;
var exports = exports;
exports.afterStoringItself = 6;
var require;
exports.typeOfRequire = typeof require;
exports.read = function () { return [exports.viaRedeclared, module.exports.viaModule, exports === module.exports].join(); };

// FILE: parallel/commonjs/exports-object-through-this-and-args/shadowed-by-parameters.cjs
if (arguments.length !== 5) {
  module.seen = [typeof exports, arguments.length, String(arguments[0]), String(module.exports)].join();
  return;
}
const other = {};
(function (exports) {
  exports.onOther = 1;
})(other);
(function (module) {
  module.exports.alsoOnOther = 2;
})({ exports: other });
{
  let exports = other;
  exports.inBlock = 3;
}
((exports, module) => { exports.inArrow = module.exports.alsoInArrow = 4; })(other, { exports: other });
try { throw other; } catch (exports) { exports.inCatch = 5; }
for (const exports of [other]) exports.inLoop = 6;
(function () {
  var exports = other, module = { exports };
  exports.inFunctionVariable = module.exports.alsoInFunctionVariable = 7;
})();
(function (arguments) { arguments[0].viaParameterCalledArguments = 8; })([other]);
(function () { this.viaOwnReceiver = arguments[0].viaOwnArguments = 9; }).call(other, other);
(function (exports) { exports.holdsTheExportsObject = 10; })(exports);
(function (module) { module.exports.alsoHoldsTheExportsObject = 11; })(module);
const calledAgain = { exports: null };
arguments.callee(undefined, undefined, calledAgain);
exports.calledAgainWithoutAnObject = calledAgain.seen;
exports.own = Object.keys(other).join();

// FILE: parallel/commonjs/exports-object-through-this-and-args/this-in-arrows.cjs
const store = (name, value) => { this[name] = value; };
exports.first = 1;
store("second", 2);
const nested = () => () => this;
exports.same = nested()() === exports;
store("first", 3);

const storeLater = () => { this.fromArrow = 4; };
(() => { this.fromCalledArrow = 5; })();
storeLater();
exports.afterTheArrows = 6;
store("stored", () => this === exports);
exports.resultOfStored = exports.stored();

const byDefault = (target = this) => target;
const holder = {
  arrow: () => this,
  method() { return (() => this)(); },
  get getter() { return (() => this)(); },
};
function ofReceiver() { return (() => this)(); }
function fillReceiver() { (() => { this.onReceiver = 7; })(); }
fillReceiver.call(holder);
class Holder {
  static self = (() => this)();
  static { (() => { this.inStaticBlock = 8; })(); }
  field = () => this;
  [(() => this.first)()] = "a computed key is evaluated outside the class";
}
const instance = new Holder();
exports.whereThisIsTheExportsObject = [byDefault() === exports, holder.arrow() === exports, instance[3]];
exports.whereItIsNot = [holder.method() === holder, holder.getter === holder, ofReceiver() === globalThis, ofReceiver.call(holder) === holder, Holder.self === Holder, instance.field() === instance];
exports.storedOnOthers = [Object.keys(holder).join(), Object.keys(Holder).join()];

(async () => {
  this.beforeAwait = 9;
  await null;
  this.afterAwait = 10;
})();
exports.set = (name, value) => { this[name] = value; return this; };
exports.fill = () => { this.filledLater = 11; return Object.keys(this).length; };

// FILE: parallel/commonjs/exports-object-through-this-and-args/this-sloppy.cjs
this.viaThis = 1;
exports.viaExports = 2;
exports.same = this === exports && this === module.exports;
exports.inFunction = (function () { return this === globalThis; })();
exports.typeOfThis = typeof this;
exports.keptOffTheGlobalObject = !("viaThis" in globalThis);

this.second = exports.first = 3;
exports.readBeforeItsStore = [this.later, "later" in this, Object.keys(this).includes("later")];
this.later = 4;
this.viaExports += 10;
for (this.lastOfLoop of [5, 6]);
for (this.lastKeyOfLoop in { a: 0, b: 0 });

Object.defineProperty(this, "readOnly", { value: 7, enumerable: true });
Object.defineProperty(this, "getterOnly", { enumerable: true, get() { return this === exports; } });
this.readOnly = 8;
this.getterOnly = 9;
exports.deleteOfReadOnly = delete this.readOnly;

function fill() {
  this.viaReceiver = 10;
  this.filledByFunction = 11;
  return this;
}
exports.receivers = [fill.call(this) === exports, typeof fill.call(12), fill.call(12).viaReceiver];
exports.fill = fill;
exports.receiverOfMethod = this.fill() === exports;
exports.filledByFunction++;

with (this) {
  viaThis += 100;
  var readInWith = second;
}
exports.readInWith = readInWith;

this.storeAfterPreventingExtensions = "not tried";
Object.preventExtensions(this);
this.tooLate = 12;
this.storeAfterPreventingExtensions = "tooLate" in this ? "stored" : "dropped";

// FILE: parallel/commonjs/exports-object-through-this-and-args/this-strict.cjs
"use strict";
this.viaThis = 1;
exports.viaExports = 2;
this.viaExports += 10;
exports.same = this === exports && this === module.exports;
exports.inFunction = (function () { return this; })();
exports.typeOfThis = typeof this;

this.storedLast = exports.storedSecond = module.exports.storedFirst = void 0;
this["storedByText"] = 3;
({ a: this.fromPattern, b: [this.fromNestedPattern = 5] } = { a: 4, b: [] });
this.fromIncrement++;
this.fromLogicalAssignment ??= 6;
this.neverCreated &&= 7;
this.viaThis ||= 8;
exports.removed = 9;
exports.deleted = delete this.removed;
this.removed = "created again";

Object.defineProperty(this, "readOnly", { value: 10, enumerable: true });
Object.defineProperty(this, "getterOnly", { enumerable: true, get() { return this === exports; } });
try {
  this.readOnly = 11;
} catch (error) {
  this.storeToReadOnly = error.constructor.name;
}
try {
  this.getterOnly = 12;
} catch (error) {
  this.storeToGetterOnly = error.constructor.name;
}
try {
  delete this.readOnly;
} catch (error) {
  this.deleteOfReadOnly = error.constructor.name;
}

class Holder {
  static self = this;
  static {
    this.inStaticBlock = 13;
  }
  field = this;
  [(this.inComputedKey = "method")]() {
    return this;
  }
}
class Derived extends (this.inHeritage = Holder) {}
const held = new Derived();
exports.inClasses = [Holder.self === Holder, Holder.inStaticBlock, "inStaticBlock" in this, held.field === held, held.method() === held];

const literal = {
  value: this,
  arrow: () => this,
  method() {
    return this;
  },
  get accessor() {
    return this;
  },
};
const { method } = literal;
exports.inLiteral = [literal.value === exports, literal.arrow() === exports, literal.method() === literal, literal.accessor === literal, method()];
exports.inArrows = [(() => this)() === exports, ((value = this) => value)() === exports, (() => () => typeof this)()()];

exports.receiver = function receiver() {
  return this;
};
exports.receivers = [this.receiver() === this, (0, this.receiver)(), this.receiver.call(14)];

exports.readThroughThis = [this.viaThis, this.viaExports, this.storedFirst, this.storedByText, this.fromPattern, this.fromNestedPattern, this.fromIncrement, this.fromLogicalAssignment, this.neverCreated, "neverCreated" in this, this.removed, this.readOnly, this.getterOnly, this.inComputedKey];

this.storeAfterPreventingExtensions = "no error";
Object.preventExtensions(this);
try {
  this.tooLate = 15;
} catch (error) {
  this.storeAfterPreventingExtensions = error.constructor.name;
}

// FILE: fixtures/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// FILE: parallel/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

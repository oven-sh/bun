// At the top of a CommonJS module `this` and `arguments[0]` are the exports object, in sloppy and in strict code, in arrow functions and in the entry point, and a variable or parameter that is only called `exports` is not.
const { describe } = require("../describe-object.cjs");
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

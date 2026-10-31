// `export * from` as TypeScript emits it for CommonJS. The program asks such objects whether they have a name: with `in`, Object.hasOwn(), hasOwnProperty(), Reflect.has() and propertyIsEnumerable(), for names that are there and for names that are not.
// Yes or no needs no accessor and no closure. Nobody lists the names and nobody asks for a descriptor, so no star is ever carried out.
// COUNT: counter:StarsRecorded = 290
// COUNT: counter:StarsCarriedOutLate = 0
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
const leaf = require("./leaf.js");
const otherLeaf = require("./other-leaf.js");
const manyNames = require("./many-names.js");
// Each is filled as a module fills its exports, and made anew for every question: an object that is asked over and over is better off with real properties, and gets them.
function oneStar() {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  return barrel;
}
function nameBehindTheStar() {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  return barrel;
}
function twoStars() {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  __exportStar(otherLeaf, barrel);
  barrel.last = "last";
  return barrel;
}
function starThatBindsANameTheCodeMayStore(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.two = "replaced";
    barrel.missing = "no longer";
  }
  return barrel;
}
function starOfStars() {
  const barrel = { __esModule: true };
  barrel.early = "early";
  __exportStar(twoStars(), barrel);
  return barrel;
}
function unmarkedStarOfStars() {
  const barrel = {};
  __exportStar(twoStars(), barrel);
  barrel.early = "behind the star";
  return barrel;
}
function manyNamesAndAStar() {
  const barrel = { __esModule: true };
  __exportStar(manyNames, barrel);
  barrel.late = "late";
  __exportStar(leaf, barrel);
  return barrel;
}
const makers = [oneStar, nameBehindTheStar, twoStars, starThatBindsANameTheCodeMayStore, starOfStars, unmarkedStarOfStars, manyNamesAndAStar];

const names = ["one", "two", "four", "early", "late", "last", "default", "__esModule", "missing", "toString", "name00", "name89"];
const ownSymbol = Symbol("nobody stores it");
const keysThatAreNoNames = [0, "1", 4294967295, 1.5, -0, null, undefined, true, Symbol.iterator, Symbol.toStringTag, ownSymbol];
const keysThatBecomeNames = [{ toString: () => "one" }, { toString: () => "missing" }, ["late"], { [Symbol.toPrimitive]: () => "four" }];
// Texts that are made while the program runs: none of them is the name itself.
const spelledAnew = name => name.slice(0, 1) + name.slice(1);
const longKeys = ["one", "missing"].map(name => name + " ".repeat(3000) + names.length);
const nativeHasOwnProperty = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const nativeHasOwn = [Object.hasOwn][0];
const letters = answers => answers.map(answer => (answer === true ? "y" : answer === false ? "n" : "?")).join("");
const questions = {
  "in, by name": b => letters(["one" in b, "two" in b, "four" in b, "early" in b, "late" in b, "last" in b, "default" in b, "__esModule" in b, "missing" in b, "toString" in b, "name00" in b, "name89" in b]),
  "in, by key": b => letters(names.map(name => name in b)),
  "in, by a key spelled anew": b => letters(names.map(name => spelledAnew(name) in b)),
  "Object.hasOwn, by name": b => letters([Object.hasOwn(b, "one"), Object.hasOwn(b, "two"), Object.hasOwn(b, "four"), Object.hasOwn(b, "early"), Object.hasOwn(b, "late"), Object.hasOwn(b, "last"), Object.hasOwn(b, "default"), Object.hasOwn(b, "__esModule"), Object.hasOwn(b, "missing"), Object.hasOwn(b, "toString"), Object.hasOwn(b, "name00"), Object.hasOwn(b, "name89")]),
  "Object.hasOwn, by key": b => letters(names.map(name => Object.hasOwn(b, name))),
  "Object.hasOwn, by a key spelled anew": b => letters(names.map(name => Object.hasOwn(b, spelledAnew(name)))),
  "hasOwnProperty, by name": b => letters([b.hasOwnProperty("one"), b.hasOwnProperty("four"), b.hasOwnProperty("late"), b.hasOwnProperty("default"), b.hasOwnProperty("missing"), b.hasOwnProperty("toString")]),
  "hasOwnProperty, by key": b => letters(names.map(name => b.hasOwnProperty(name))),
  "hasOwnProperty.call, by name": b => letters([Object.prototype.hasOwnProperty.call(b, "one"), Object.prototype.hasOwnProperty.call(b, "four"), Object.prototype.hasOwnProperty.call(b, "late"), Object.prototype.hasOwnProperty.call(b, "missing")]),
  "hasOwnProperty.call, by key": b => letters(names.map(name => Object.prototype.hasOwnProperty.call(b, name))),
  "the built-in functions as values": b => letters(names.flatMap(name => [nativeHasOwnProperty(b, name), nativeHasOwn(b, name)])),
  "Reflect.has": b => letters(names.map(name => Reflect.has(b, name))),
  "propertyIsEnumerable": b => letters(names.map(name => Object.prototype.propertyIsEnumerable.call(b, name))),
  "keys that are no names": b => letters(keysThatAreNoNames.flatMap(key => [key in b, Object.hasOwn(b, key), Reflect.has(b, key)])),
  "keys that are no names, by the methods": b => letters(keysThatAreNoNames.flatMap(key => [Object.prototype.hasOwnProperty.call(b, key), Object.prototype.propertyIsEnumerable.call(b, key)])),
  "reads under keys that are no names": b => keysThatAreNoNames.map(key => String(b[key])).join(),
  "keys that become names": b => letters(keysThatBecomeNames.flatMap(key => [key in b, Object.hasOwn(b, key), b.hasOwnProperty(key)])),
  "long keys": b => letters(longKeys.flatMap(key => [key in b, Object.hasOwn(b, key)])),
  "asked, then read": b => names.map(name => (name in b && Object.hasOwn(b, name) ? String(b[name]) : "-")).join(),
  "read, then asked": b => names.map(name => (b[name] !== undefined ? letters([name in b, Object.hasOwn(b, name)]) : "-")).join(),
  "the same name again": b => letters([1, 2, 3, 4].flatMap(() => ["two" in b, Object.hasOwn(b, "two"), "missing" in b, Object.hasOwn(b, "missing")])),
  "Object.prototype.toString": b => Object.prototype.toString.call(b) + String(b),
};
for (const [question, ask] of Object.entries(questions)) console.log(question + ":", makers.map(make => ask(make(false))).join(" "));

const oneStarModule = require("./barrels/one-star.js");
const twoStarsModule = require("./barrels/two-stars.js");
const starOfStarsModule = require("./barrels/star-of-stars.js");
console.log("one" in oneStarModule, "default" in oneStarModule, "missing" in oneStarModule, Object.hasOwn(oneStarModule, "three"), Object.hasOwn(oneStarModule, "four"), oneStarModule.hasOwnProperty("two"));
console.log("four" in twoStarsModule, "late" in twoStarsModule, "missing" in twoStarsModule, Object.hasOwn(twoStarsModule, "five"), Object.hasOwn(twoStarsModule, "last"), Object.hasOwn(twoStarsModule, "outer"));
console.log("five" in starOfStarsModule, "outer" in starOfStarsModule, "missing" in starOfStarsModule, Object.hasOwn(starOfStarsModule, "late"), Object.hasOwn(starOfStarsModule, "default"));
console.log("feature" in starOfStarsModule ? starOfStarsModule.feature() : "no such feature", "one" in starOfStarsModule ? starOfStarsModule.one : "no such name");
leaf.one = "one, changed";
console.log("one" in oneStarModule && oneStarModule.one, Object.hasOwn(starOfStarsModule, "one") && starOfStarsModule.one);

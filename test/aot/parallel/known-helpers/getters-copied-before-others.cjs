// What __toCommonJS() finds is not known here, so the helper runs: names that a function adds, names that two calls define, names of an object that others fill.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
const out = [];
const describe = (it) => Object.entries(Object.getOwnPropertyDescriptors(it)).map(([name, d]) => name + ":" + d.enumerable + (d.get ? d.get.name + String(d.get) : typeof d.value)).join(";");
const tell = (f) => { try { out.push(String(f())); } catch (error) { out.push(error.constructor.name); } };
var first = {};
if (out.length === 0) __export(first, { a: () => 1 });
tell(() => describe(__toCommonJS(first)));
var second = {};
__export(second, { a: () => this === module.exports, b() { return this === second; }, c: function () { return Object.keys(this).join(); } });
var copy = __toCommonJS(second);
tell(() => [copy.a, copy.b, copy.c]);
var third = {};
__export(third, { a: () => 1 });
third.b = 2;
var copyOfThird = __toCommonJS(third);
third.b = 3;
tell(() => [copyOfThird.a, copyOfThird.b, describe(copyOfThird)]);
var fourth = {};
__export(fourth, { a: () => 1, __esModule: () => "own" });
var copyOfFourth = __toCommonJS(fourth);
tell(() => [copyOfFourth.__esModule, describe(copyOfFourth)]);
var fifth = {};
var early = __toCommonJS(fifth);
__export(fifth, { a: () => 1 });
tell(() => [describe(early), describe(fifth)]);
var sixth = {};
__export(sixth, { 7: () => 7, a: () => 1, 3: () => 3 });
var copyOfSixth = __toCommonJS(sixth);
tell(() => describe(copyOfSixth));
var seventh = {};
__export(seventh, { a: async () => 1, *b() { yield 1; }, c: (x) => typeof x });
var copyOfSeventh = __toCommonJS(seventh);
tell(() => [copyOfSeventh.a, copyOfSeventh.b, copyOfSeventh.c]);
for (let i = 0; i < 2; i++) { var eighth = {}; __export(eighth, { i: () => i }); tell(() => __toCommonJS(eighth).i); }
function inside(x) { var ninth = {}; __export(ninth, { x: () => x }); return __toCommonJS(ninth); }
tell(() => [inside(1).x, inside(2).x]);
var tenth = {};
__export(tenth, { a: () => 1 });
tell(() => __export(tenth, { a: () => 2 }));
var copyOfTenth = __toCommonJS(tenth);
tell(() => copyOfTenth.a);
var eleventh = {};
__export(eleventh, { value: () => value });
var copyOfEleventh = __toCommonJS(eleventh);
tell(() => copyOfEleventh.value);
let value = 5;
tell(() => copyOfEleventh.value);
module.exports = __toCommonJS(second);
console.log(out.join("\n"));

// The programs of function-prototypes that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "constructor-functions-made-and-constructed-in-turn-while-earlier-ones-change.js": text(
      `globalThis.keep = [];
var nameOfField = new Function("return 'x'")();
globalThis.seen = [];`,
      [
        10,
        n => `function F${n}(x) { this.x = x; }
F${n}.prototype.a = function (x) { return x + ${n + 1}; };
F${n}.prototype.b = function (x) { return this.a(x) * 2; };
F${n}.prototype.c = function () { return this; };
F${n}.e = function () { return 5; };
keep.push(new F${n}(${n}));`,
      ],
      `// Stores of \`x\` no longer pass by the prototype object of a function that was constructed early, while most of the others are not there yet.
Object.defineProperty(Object.getPrototypeOf(keep[3]), nameOfField, { set(value) { seen.push("set " + value); }, get() { return "got"; }, configurable: true });`,
      [
        15,
        n => `function F${n + 10}(x) { this.x = x; }
F${n + 10}.prototype.a = function (x) { return x + ${n + 11}; };
F${n + 10}.prototype.b = function (x) { return this.a(x) * 2; };
F${n + 10}.prototype.c = function () { return this; };
F${n + 10}.e = function () { return 5; };
keep.push(new F${n + 10}(${n + 10}));`,
      ],
      `Object.setPrototypeOf(Object.getPrototypeOf(keep[5]), Object.defineProperty({}, nameOfField, { set(value) { seen.push("above " + value); }, get() { return "above"; } }));`,
      [
        15,
        n => `function F${n + 25}(x) { this.x = x; }
F${n + 25}.prototype.a = function (x) { return x + ${n + 26}; };
F${n + 25}.prototype.b = function (x) { return this.a(x) * 2; };
F${n + 25}.prototype.c = function () { return this; };
F${n + 25}.e = function () { return 5; };
keep.push(new F${n + 25}(${n + 25}));`,
      ],
      `function again(round) {
  keep.push(new F3(round + 3));
  keep.push(new F5(round + 5));
  keep.push(new F10(round + 10));
  keep.push(new F11(round + 11));
  keep.push(new F25(round + 25));
  keep.push(new F26(round + 26));
  keep.push(new F39(round + 39));
  keep.push(new F0(round + 0));
}
again(100);
again(200);
again(300);
console.log(seen.join(", "));
console.log(keep.map(made => Object.keys(made).join("") + ":" + made.x + ":" + made.b(1)).join(" "));
`,
    ),
    "many-constructor-functions-share-method-names-and-some-change-between-first-constructions.js": text(
      `var unseen = new Function("x", "return x");
globalThis.made = [];
var lines = [];`,
      [
        48,
        n => `function F${n}(x) { this.x = x; }
F${n}.prototype.a = function (x) { return "a${n}:" + x; };
F${n}.prototype.b = function (x) { return this.a(x) + "/" + this.c(); };
F${n}.prototype.c = function () { return "c${n}"; };`,
      ],
      `function askAll(label) {
  var answers = [];
  for (var index = 0; index < made.length; index++)
    answers.push(made[index].b(index));
  lines.push(label + " " + answers.join(" "));
}
// Every \`b\` is called on an object of another function too, so \`this\` is any of them.
function askAcross(label, method) {
  var answers = [];
  for (var index = 0; index < made.length; index++)
    answers.push(method.call(made[index], index));
  lines.push(label + " " + answers.join(" "));
}`,
      [
        3,
        n => `made.push(new F${6 * n}(${6 * n}));
made.push(new F${6 * n + 1}(${6 * n + 1}));
made.push(new F${6 * n + 2}(${6 * n + 2}));
made.push(new F${6 * n + 3}(${6 * n + 3}));
made.push(new F${6 * n + 4}(${6 * n + 4}));
made.push(new F${6 * n + 5}(${6 * n + 5}));
askAll("after F${6 * n + 5}");`,
      ],
      `made.push(new F18(18));
made.push(new F19(19));
// Members of functions that were constructed early change while most of the others have not been constructed yet.
var kept3 = F3.prototype.a;
unseen(F3).prototype.a = function (x) { return "replaced3:" + x; };
delete unseen(F7).prototype.a;
Object.setPrototypeOf(unseen(F7).prototype, { a: function (x) { return "above7:" + x; } });
Object.defineProperty(unseen(F11).prototype, "c", { get: function () { return function () { return "got11"; }; }, configurable: true });
askAll("three changed");
askAcross("across by F0", F0.prototype.b);
// The rest is constructed from the last to the first, and one that has not been constructed yet changes on the way.`,
      [
        2,
        n => `made.push(new F${47 - 7 * n}(${47 - 7 * n}));
made.push(new F${46 - 7 * n}(${46 - 7 * n}));
made.push(new F${45 - 7 * n}(${45 - 7 * n}));
made.push(new F${44 - 7 * n}(${44 - 7 * n}));
made.push(new F${43 - 7 * n}(${43 - 7 * n}));
made.push(new F${42 - 7 * n}(${42 - 7 * n}));
made.push(new F${41 - 7 * n}(${41 - 7 * n}));
askAll("after F${41 - 7 * n}");`,
      ],
      `made.push(new F33(33));
made.push(new F32(32));
made.push(new F31(31));
unseen(F25).prototype.a = function (x) { return "early25:" + x; };
unseen(F1).prototype.c = function () { return "late1"; };
made.push(new F30(30));
made.push(new F29(29));
made.push(new F28(28));
made.push(new F27(27));
askAll("after F27");
made.push(new F26(26));
made.push(new F25(25));
made.push(new F24(24));
made.push(new F23(23));
made.push(new F22(22));
made.push(new F21(21));
made.push(new F20(20));
askAll("after F20");
askAll("all made");
askAcross("across by F47", F47.prototype.b);
askAcross("across by F25", F25.prototype.b);
unseen(F3).prototype.a = kept3;
askAll("F3 put back");
unseen(F46).prototype.a = function (x) { return "last:" + x; };
unseen(F0).prototype.a = function (x) { return "first:" + x; };
askAll("the ends changed");
askAcross("across by F12", F12.prototype.b);

// One method above many functions: one site, one callee, and a condition for each of the functions. A late one stands in the way, then an early one too, then the late one is repaired.
function GBase() {}
GBase.prototype.who = function () { return "base"; };
GBase.prototype.size = 1;`,
      [
        28,
        n => `function G${n}() { this.n = ${n}; }
Object.setPrototypeOf(G${n}.prototype, GBase.prototype);`,
      ],
      `var allG = [];
function askG(label) {
  var answers = [];
  for (var index = 0; index < allG.length; index++)
    answers.push(allG[index].who() + allG[index].size);
  lines.push("G " + label + " " + answers.join(" "));
}
unseen(G25).prototype.who = function () { return "late"; };
allG.push(new G0());
allG.push(new G1());
allG.push(new G2());
allG.push(new G3());
allG.push(new G4());
allG.push(new G5());
askG("six");
allG.push(new G25());
askG("with the late one");
allG.push(new G6());
allG.push(new G7());
allG.push(new G8());
allG.push(new G9());
allG.push(new G10());
allG.push(new G11());
askG("twelve");
unseen(G1).prototype.who = function () { return "early"; };
askG("an early one too");
delete unseen(G25).prototype.who;
askG("the late one repaired");`,
      [13, n => `allG.push(new G${n + 12}());`],
      `allG.push(new G26());
allG.push(new G27());
askG("all");
delete unseen(G1).prototype.who;
askG("both repaired");
Object.defineProperty(unseen(G27).prototype, "size", { value: 9, configurable: true });
unseen(G2).prototype.who = function () { return "second"; };
askG("the last and the third");
delete unseen(G27).prototype.size;
askG("the last repaired");
unseen(GBase).prototype.who = function () { return "BASE"; };
askG("the one above changed");
class HBase { who() { return "base"; } get size() { return 1; } }`,
      [28, n => `class H${n} extends HBase { constructor() { super(); this.n = ${n}; } }`],
      `var allH = [];
function askH(label) {
  var answers = [];
  for (var index = 0; index < allH.length; index++)
    answers.push(allH[index].who() + allH[index].size);
  lines.push("H " + label + " " + answers.join(" "));
}
unseen(H25).prototype.who = function () { return "late"; };
allH.push(new H0());
allH.push(new H1());
allH.push(new H2());
allH.push(new H3());
allH.push(new H4());
allH.push(new H5());
askH("six");
allH.push(new H25());
askH("with the late one");
allH.push(new H6());
allH.push(new H7());
allH.push(new H8());
allH.push(new H9());
allH.push(new H10());
allH.push(new H11());
askH("twelve");
unseen(H1).prototype.who = function () { return "early"; };
askH("an early one too");
delete unseen(H25).prototype.who;
askH("the late one repaired");`,
      [13, n => `allH.push(new H${n + 12}());`],
      `allH.push(new H26());
allH.push(new H27());
askH("all");
delete unseen(H1).prototype.who;
askH("both repaired");
Object.defineProperty(unseen(H27).prototype, "size", { value: 9, configurable: true });
unseen(H2).prototype.who = function () { return "second"; };
askH("the last and the third");
delete unseen(H27).prototype.size;
askH("the last repaired");
unseen(HBase).prototype.who = function () { return "BASE"; };
askH("the one above changed");
console.log(lines.join("\\n"));
`,
    ),
  });

// An eval runs the string that it gets, in its own scope, also where the constants of its function look as if they led to another.
globalThis.local = "global";
const show = (name, run) => {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.name;
  }
  console.log(name, answer);
};
const two = "(function () { return 2; })";

function spread() { const local = "own", parts = ["(function () { return local; })"]; return eval(...parts)(); }
function spreadBefore() { const none = [], local = "own"; return eval(...none, "(function () { return local; })", "x")(); }
function spreadInLoop() { const made = []; for (const name of ["a", "b"]) { const parts = ["(function () { return '" + name + "'; })"]; made.push(eval(...parts)()); } return made.join(); }
function spreadRefused() {
  const local = "own";
  let seen = "";
  for (const parts of [["(function () { return local; })"], ["(function () { let a; let a; })"]]) {
    show("refused", () => seen);
    seen = eval(...parts)();
  }
  return seen;
}
for (const run of [spread, spreadBefore, spreadInLoop, spreadRefused]) show(run.name, run);

function make() { return "(function () { return 1; })"; }
function useMake() { return eval(make())(); }
function inner() { return "1"; }
function makeOfInner() { return "(function () { return " + inner() + "; })"; }
function useInner() { return eval(makeOfInner())(); }
function helper() {
  let part = "(function () { return 1; })";
  function change(text) { eval(text); }
  change(process.argv.length > 0 ? "part = '(function () { return 2; })'" : "");
  return part;
}
function useHelper() { return eval(helper())(); }
function replace(text) { return eval(text); }
show("before", () => useMake() + "," + useInner());
replace(process.argv.length > 0 ? "make = function () { return two; }; inner = () => '2'" : "");
show("after", () => useMake() + "," + useInner() + "," + useHelper());

function namesAndIndices() { let text = ""; for (const key in { b: 0, 4294967295: 0, a: 0, 4294967294: 0, 1000000000: 0, "01": 0 }) text += key + " "; return eval("(function () { return '" + text + "'; })")(); }
function storedIndex() { const object = { z: 1 }; object[4294967293] = 2; let text = ""; for (const key in object) text += key + " "; return eval("(function () { return '" + text + "'; })")(); }
function elements() { const list = ["a", "b"]; let text = ""; for (const key in list) text += key + " "; return eval("(function () { return '" + text + "'; })")(); }
for (const run of [namesAndIndices, storedIndex, elements]) show(run.name, run);
const added = process.argv.length > 0 ? "added" : "other";
Array.prototype[added] = 5;
show("elements, added", elements);
delete Array.prototype[added];
function trimmed() { return eval("(function () { return '" + " a ".trim() + "'; })")(); }
show("trimmed", trimmed);
const { trim } = String.prototype;
String.prototype.trim = function () { return "replaced"; };
show("trimmed, replaced", trimmed);
String.prototype.trim = trim;

function added2() { const o = { text: "(function () { return 1; })", valueOf() { this.text = "(function () { return 2; })"; return 1; } }; o + 1; return eval(o.text)(); }
function compared() { const o = { text: "(function () { return 1; })", valueOf() { this.text = "(function () { return 2; })"; return 1; } }; o < 2; return eval(o.text)(); }
function equal() { const o = { text: "(function () { return 1; })", valueOf() { this.text = "(function () { return 2; })"; return 1; } }; o == 1; return eval(o.text)(); }
function negated() { const o = { text: "(function () { return 1; })", valueOf() { this.text = "(function () { return 2; })"; return 1; } }; -o; return eval(o.text)(); }
function counted() { const o = { text: "(function () { return 1; })", valueOf() { this.text = "(function () { return 2; })"; return 1; } }; let n = o; n++; return eval(o.text)(); }
function inTemplate() { const o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return ""; } }; `${o}`; return eval(o.text)(); }
function asKey() { const o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; const p = { [o]: 1 }; return eval(o.text)(); }
function asIndex() { const p = { k: 1 }, o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; p[o]; return eval(o.text)(); }
function asStoredIndex() { const p = { k: 1 }, o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; p[o] = 2; return eval(o.text)(); }
function asName() { const p = { k: 1 }, o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; o in p; return eval(o.text)(); }
function asPattern() { const o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; RegExp(o); return eval(o.text)(); }
function inList() { const o = { text: "(function () { return 1; })", toString() { this.text = "(function () { return 2; })"; return "k"; } }; "" + [o]; return eval(o.text)(); }
function tested() { class Changer { static [Symbol.hasInstance](it) { it.text = "(function () { return 2; })"; } } const o = { text: "(function () { return 1; })" }; o instanceof Changer; return eval(o.text)(); }
for (const run of [added2, compared, equal, negated, counted, inTemplate, asKey, asIndex, asStoredIndex, asName, asPattern, inList, tested]) show(run.name, run);

function keyOfMethod(text) { let local = 3; const o = { [eval(text)](a) { return eval("(function () { return a + local; })")(); } }; return o.k(4); }
function keyOfClass(text) { class C { [eval(text)]() {} static [eval(text)]() {} } return Object.getOwnPropertyNames(C.prototype) + "," + Object.keys(C); }
function keyBeforeStrictCode() { const o = { [eval("(function () { return typeof this; })")()]() { "use strict"; } }; return Object.keys(o).join(); }
show("keyOfMethod", () => keyOfMethod("local = 9; 'k'"));
show("keyOfClass", () => keyOfClass("'k'"));
show("keyBeforeStrictCode", keyBeforeStrictCode);
function defaultOfEmpty(text) { function empty(a = eval(text)) {} empty(); return eval("(function () { return text; })")(); }
show("defaultOfEmpty", () => defaultOfEmpty("text = 'changed'"));

function callTarget() { const local = "own", f = () => 1; return eval("(function () { if (local) return local; f() = 1; })")(); }
function callTargetInLoop() { const local = "own", f = () => 1; return eval("(function () { if (local) return local; for (f() of []); })")(); }
function countedCall() { const local = "own", f = () => 1; return eval("(function () { if (local) return local; f()++; })")(); }
for (const run of [callTarget, callTargetInLoop, countedCall]) show(run.name, run);
async function awaitAsParameter() { const local = "own"; return eval("((await) => local + await)")(1); }
async function awaitAsOnlyParameter() { const local = "own"; return eval("(await => local + await)")(2); }
awaitAsParameter().then(console.log).then(awaitAsOnlyParameter).then(console.log);
function joinedHalves() { return eval("(function () { return " + ("\ud83d".concat("\ude00") === "\u{1F600}" ? 1 : 2) + "; })")(); }
show("joinedHalves", joinedHalves);
function startOfPair() { return eval("(function () { return " + ("\u{1F600}".startsWith("\ud83d") ? 1 : 2) + "; })")(); }
show("startOfPair", startOfPair);

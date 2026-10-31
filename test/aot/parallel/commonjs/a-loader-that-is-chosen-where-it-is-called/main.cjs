// `(other ?? require)("./leaf.cjs")`: the build reads the name, so the file is in the executable. Which of the two is called is asked where the call runs.
const say = (...words) => console.log(...words);
const pick = () => (globalThis.otherLoader ?? require)("./leaf.cjs");
const pickByTest = () => (typeof otherLoader === "function" ? otherLoader : require)("./leaf.cjs");
const pickByOr = () => (globalThis.otherLoader || require)("./leaf.cjs");
say("nothing else is there:", pick().name, pickByTest().name, pickByOr().name, pick() === require("./leaf.cjs"));
globalThis.otherLoader = name => ({ name: "the other loader got " + name });
say("another loader is there:", pick().name, "|", pickByTest().name, "|", pickByOr().name);
delete globalThis.otherLoader;
say("and gone again:", pick().name, pickByTest().name, pickByOr().name);
const held = globalThis.nobody ?? require;
say("held in a variable:", held("./leaf.cjs").name, held === require);
try {
  (globalThis.nobody ?? null)("./leaf.cjs");
} catch (error) {
  say("neither is a function:", error.name);
}
// A choice that leads back to itself: the build has to come to an end.
var again = again || require;
var byTest = typeof byTest === "function" ? byTest : require;
var one = two ?? require;
var two = one ?? require;
say(
  "choices that name themselves:",
  again("./leaf.cjs").name,
  byTest("./leaf.cjs").name,
  one("./leaf.cjs").name,
  two("./leaf.cjs").name,
);
// The same in a field, a static field, a method and a function.
class Loads {
  field = (globalThis.nothingHere ?? require)("./leaf.cjs").name;
  static ofClass = (typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require)("./leaf.cjs")
    .name;
  method() {
    return (globalThis.nothingHere || require)("./leaf.cjs").name;
  }
}
function inFunction() {
  var load = load || require;
  return load("./leaf.cjs").name;
}
say(
  "in a field, a static field, a method and a function:",
  new Loads().field,
  Loads.ofClass,
  new Loads().method(),
  inFunction(),
);

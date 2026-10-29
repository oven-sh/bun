// require() of an ES module evaluates it where the call stands, once, and answers its namespace object.
import * as marked from "./marked.mjs";
import { log } from "./log.mjs";

log("main begins");
const plain = require("./plain.mjs");
log("behind the call", plain.value, plain.twice(21), Object.keys(plain).join(), plain === require("./plain.mjs"), plain.__esModule);

log("the mark before", marked.__esModule, "__esModule" in marked, Object.keys(marked).join());
require("./marked.mjs");
log("the mark behind", marked.__esModule, Object.keys(marked).join());

require("./only-for-its-effect.mjs");
require("./only-for-its-effect.mjs");

if (globalThis.neverSet) require("./never-run.mjs");

const withImports = require("./with-imports.mjs");
log("with imports", withImports.sum);

const first = require("./cycle-first.mjs");
log("cycle", first.name, first.seenBySecond);

function attempt(load) {
  try {
    return load();
  } catch (error) {
    return error;
  }
}
const thrown = attempt(() => require("./throws.mjs"));
const thrownAgain = attempt(() => require("./throws.mjs"));
log("throws", thrown.message, thrown === thrownAgain, globalThis.timesThrown);
const rejected = await import("./throws.mjs").then(
  () => "fulfilled",
  error => error,
);
log("import() of it", rejected === thrown);

const below = attempt(() => require("./imports-what-throws.mjs"));
const belowAgain = attempt(() => require("./imports-what-throws.mjs"));
const dependency = attempt(() => require("./throws-below.mjs"));
log("a dependency throws", below.message, below === belowAgain, below === dependency, globalThis.ranBehindTheFailure);

function later() {
  const late = require("./late.mjs");
  return late.value;
}
await new Promise(resolve => setTimeout(resolve, 1));
log("outside every evaluation", later(), later());
const lateError = attempt(() => require("./late-throws.mjs"));
log("and a failure there", lateError.message, lateError === attempt(() => require("./late-throws.mjs")));

const own = require("./has-its-own-mark.mjs");
log("its own mark", own.__esModule, own.default);
log("main ends");

// Each file has a list of its own names. What a file imports is among its names, and text reads the live binding and may not store to it.
import lookInOther, { bump, count, label as named } from "./other.mjs";
import * as whole from "./other.mjs";

let own = JSON.parse('"main"');
function look(text) {
  return eval(text);
}
function alsoLook(text) {
  return eval(text);
}
function kind(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor === TypeError ? "TypeError" : "other";
  }
}
console.log(
  look("count"),
  bump(),
  alsoLook("count"),
  look("whole.count"),
  look("named"),
  look("own"),
  lookInOther("own"),
);
console.log(
  lookInOther("typeof named"),
  look("typeof hidden"),
  lookInOther("count = 10; hidden"),
  alsoLook("count"),
  count,
);
console.log(
  kind(() => look("count = 1")),
  kind(() => look("whole = 1")),
  kind(() => alsoLook("named = 1")),
);
console.log(look("lookInOther === whole.default"), own);

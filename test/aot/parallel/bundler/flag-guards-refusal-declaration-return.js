// A block that a flag that is on guards may leave the function, also between the declaration of a variable and the `return` that gives it back.
// Flags: --feature SOME_FLAG
// Reference: bun build --compile
import { feature } from "bun:bundle";
function lookUp(key) {
  return "found " + key;
}
function f(key) {
  const t = lookUp(key);
  if (feature("SOME_FLAG")) {
    if (key !== "allowed") {
      return undefined;
    }
  }
  return t;
}
console.log(f("allowed"), f("refused"));

function refusesAll(key) {
  const t = lookUp(key);
  if (feature("SOME_FLAG")) {
    return undefined;
  }
  return t;
}
console.log(refusesAll("allowed"));

function refusesUnderAFlagThatIsOff(key) {
  const t = lookUp(key);
  if (feature("ANOTHER_FLAG")) {
    return undefined;
  }
  return t;
}
console.log(refusesUnderAFlagThatIsOff("allowed"));

class Table {
  refused = 0;
  find(key) {
    const t = lookUp(key);
    if (feature("SOME_FLAG")) {
      if (key !== "allowed") {
        this.refused++;
        return undefined;
      }
    }
    return t;
  }
}
const table = new Table();
console.log(table.find("allowed"), table.find("refused"), table.refused);

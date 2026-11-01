// A function that createRequire() makes is called where its variable is still undefined, or is never filled: the call throws, however the callee is written.
import { createRequire } from "node:module";

function told(ask) {
  try {
    return "answered " + typeof ask();
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

const behindComma = (0, made);
const behindName = made;
function inFunction() {
  const held = (0, made);
  return held("node:os");
}

console.log("a comma: " + told(() => (0, made)("node:os")));
console.log("a constant behind a comma: " + told(() => behindComma("node:os")));
console.log("a constant behind a name: " + told(() => behindName("node:os")));
console.log("a name: " + told(() => made("node:os")));
console.log("in a function: " + told(inFunction));
console.log("never made: " + told(() => (0, neverMade)("node:os")));

var made = createRequire(import.meta.url);
if (Date.now() < 0) {
  var neverMade = createRequire(import.meta.url);
}

console.log("made by now, a comma: " + told(() => (0, made)("node:os")));
console.log("made by now, in a function: " + told(inFunction));
console.log(
  "the constants stay as they were: " + told(() => behindComma("node:os")) + ", " + told(() => behindName("node:os")),
);
console.log("never made: " + told(() => (0, neverMade)("node:os")));

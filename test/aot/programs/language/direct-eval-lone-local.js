// The text of a direct eval reads and stores a local whose name no property, export or other binding of the program has.
export {};

function readThroughEval() {
  let heldOnlyByEvalScope = 1;
  return eval("heldOnlyByEvalScope");
}
console.log(readThroughEval());

function storeThroughEval(text) {
  let seenOnlyByAssembledText = 2;
  eval(text);
  return seenOnlyByAssembledText;
}
console.log(storeThroughEval(["seenOnly", "ByAssembledText", " += 40"].join("")));

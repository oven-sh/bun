// The text "constructor" as a value and never as a key: Link notes a spelled text under which an evaluator hangs as a name that is read.
const word = "constructor";
const seen = new Map([[word, 1]]);
console.log(word, `constructor`.length, "con" + "structor" === word, seen.get("constructor"));

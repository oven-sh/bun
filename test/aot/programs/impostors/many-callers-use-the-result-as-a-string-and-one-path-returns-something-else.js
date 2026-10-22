function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function forLengthOf(value, which, text) {
  if (which === 1) return ["a", "b"];
  if (which === 2) return (0, eval)(text);
  return value;
}

function lengthOf(value, which, text) {
  return forLengthOf(value, which, text).length;
}

function forCodeOf(value, which, text) {
  if (which === 1) return 65;
  if (which === 2) return (0, eval)(text);
  return value;
}

function codeOf(value, which, text) {
  return forCodeOf(value, which, text).charCodeAt(0);
}

function forExclaimed(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function exclaimed(value, which, text) {
  return forExclaimed(value, which, text) + "!";
}

function forTailOf(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function tailOf(value, which, text) {
  return forTailOf(value, which, text).slice(1);
}

function forShouted(value, which, text) {
  if (which === 1) return new String("ab");
  if (which === 2) return (0, eval)(text);
  return value;
}

function shouted(value, which, text) {
  return forShouted(value, which, text).toUpperCase();
}

function forFirstOf(value, which, text) {
  if (which === 1) return { length: 2 };
  if (which === 2) return (0, eval)(text);
  return value;
}

function firstOf(value, which, text) {
  return forFirstOf(value, which, text)[0];
}

function forIsAb(value, which, text) {
  if (which === 1) return Symbol("ab");
  if (which === 2) return (0, eval)(text);
  return value;
}

function isAb(value, which, text) {
  return forIsAb(value, which, text) === "ab";
}

function forBeforeB(value, which, text) {
  if (which === 1) return 1;
  if (which === 2) return (0, eval)(text);
  return value;
}

function beforeB(value, which, text) {
  return forBeforeB(value, which, text) < "b";
}

function forInTemplate(value, which, text) {
  if (which === 1) return { toString: () => "ab" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function inTemplate(value, which, text) {
  return `<${forInTemplate(value, which, text)}>`;
}

function forSplit(value, which, text) {
  if (which === 1) return /b/;
  if (which === 2) return (0, eval)(text);
  return value;
}

function split(value, which, text) {
  return forSplit(value, which, text).split("");
}

function forSearched(value, which, text) {
  if (which === 1) return ["b"];
  if (which === 2) return (0, eval)(text);
  return value;
}

function searched(value, which, text) {
  return forSearched(value, which, text).indexOf("b");
}

function forAsKey(value, which, text) {
  if (which === 1) return 1n;
  if (which === 2) return (0, eval)(text);
  return value;
}

function asKey(value, which, text) {
  return ({ ab: "found", 1: "one" })[forAsKey(value, which, text)];
}

const hidden = [
  "[\"a\", \"b\"]",
  "65",
  "null",
  "undefined",
  "new String(\"ab\")",
  "true",
  "1n",
  "Symbol(\"ab\")",
  "({ toString() { return \"ab\"; } })",
  "({ valueOf() { return \"ab\"; }, toString() { return \"cd\"; } })",
  "({ length: 1, charCodeAt() { return \"its own\"; }, slice() { return \"its own\"; }, toUpperCase() { return \"its own\"; }, split() { return \"its own\"; }, indexOf() { return \"its own\"; } })",
  "Buffer.from(\"ab\")",
];

function honest(round) {
  console.log(round, "lengthOf", show(lengthOf("ab")), show(lengthOf("")), show(lengthOf("xyz")), show(lengthOf(`a${1}`)), show(lengthOf(String(12))));
  console.log(round, "codeOf", show(codeOf("ab")), show(codeOf("")), show(codeOf("xyz")), show(codeOf(`a${1}`)), show(codeOf(String(12))));
  console.log(round, "exclaimed", show(exclaimed("ab")), show(exclaimed("")), show(exclaimed("xyz")), show(exclaimed(`a${1}`)), show(exclaimed(String(12))));
  console.log(round, "tailOf", show(tailOf("ab")), show(tailOf("")), show(tailOf("xyz")), show(tailOf(`a${1}`)), show(tailOf(String(12))));
  console.log(round, "shouted", show(shouted("ab")), show(shouted("")), show(shouted("xyz")), show(shouted(`a${1}`)), show(shouted(String(12))));
  console.log(round, "firstOf", show(firstOf("ab")), show(firstOf("")), show(firstOf("xyz")), show(firstOf(`a${1}`)), show(firstOf(String(12))));
  console.log(round, "isAb", show(isAb("ab")), show(isAb("")), show(isAb("xyz")), show(isAb(`a${1}`)), show(isAb(String(12))));
  console.log(round, "beforeB", show(beforeB("ab")), show(beforeB("")), show(beforeB("xyz")), show(beforeB(`a${1}`)), show(beforeB(String(12))));
  console.log(round, "inTemplate", show(inTemplate("ab")), show(inTemplate("")), show(inTemplate("xyz")), show(inTemplate(`a${1}`)), show(inTemplate(String(12))));
  console.log(round, "split", show(split("ab")), show(split("")), show(split("xyz")), show(split(`a${1}`)), show(split(String(12))));
  console.log(round, "searched", show(searched("ab")), show(searched("")), show(searched("xyz")), show(searched(`a${1}`)), show(searched(String(12))));
  console.log(round, "asKey", show(asKey("ab")), show(asKey("")), show(asKey("xyz")), show(asKey(`a${1}`)), show(asKey(String(12))));
}

honest("before");
attempt("lengthOf, the other path in sight", () => lengthOf(undefined, 1));
for (const text of hidden) attempt("lengthOf of " + text, () => lengthOf(undefined, 2, text));
attempt("codeOf, the other path in sight", () => codeOf(undefined, 1));
for (const text of hidden) attempt("codeOf of " + text, () => codeOf(undefined, 2, text));
attempt("exclaimed, the other path in sight", () => exclaimed(undefined, 1));
for (const text of hidden) attempt("exclaimed of " + text, () => exclaimed(undefined, 2, text));
attempt("tailOf, the other path in sight", () => tailOf(undefined, 1));
for (const text of hidden) attempt("tailOf of " + text, () => tailOf(undefined, 2, text));
attempt("shouted, the other path in sight", () => shouted(undefined, 1));
for (const text of hidden) attempt("shouted of " + text, () => shouted(undefined, 2, text));
attempt("firstOf, the other path in sight", () => firstOf(undefined, 1));
for (const text of hidden) attempt("firstOf of " + text, () => firstOf(undefined, 2, text));
attempt("isAb, the other path in sight", () => isAb(undefined, 1));
for (const text of hidden) attempt("isAb of " + text, () => isAb(undefined, 2, text));
attempt("beforeB, the other path in sight", () => beforeB(undefined, 1));
for (const text of hidden) attempt("beforeB of " + text, () => beforeB(undefined, 2, text));
attempt("inTemplate, the other path in sight", () => inTemplate(undefined, 1));
for (const text of hidden) attempt("inTemplate of " + text, () => inTemplate(undefined, 2, text));
attempt("split, the other path in sight", () => split(undefined, 1));
for (const text of hidden) attempt("split of " + text, () => split(undefined, 2, text));
attempt("searched, the other path in sight", () => searched(undefined, 1));
for (const text of hidden) attempt("searched of " + text, () => searched(undefined, 2, text));
attempt("asKey, the other path in sight", () => asKey(undefined, 1));
for (const text of hidden) attempt("asKey of " + text, () => asKey(undefined, 2, text));
honest("after");

console.log("bytes made in plain sight", Buffer.from("he").length);

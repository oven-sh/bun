// The text of a pattern is put together from the members of a list in a loop that sets a bar between them, and asks in each turn whether it is the first: by the counter's being true, by its
// negation, by comparing it for equality. The build follows each turn, so it knows the way of each of these tests and with it the whole text.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
const words = ["alpha", "beta", "gamma", "delta"];
function byTruth() {
  let text = "^(?:";
  for (let index = 0; index < words.length; index++) text += (index ? "|" : "") + words[index];
  return new RegExp(text + ")$");
}
function byNegation() {
  let text = "";
  for (let index = 0; index < words.length; index++) text += (!index ? "" : "|") + words[index] + "+";
  return new RegExp(text);
}
function byEquality() {
  let text = "";
  for (let index = 0; index < words.length; index++) text += (index === 0 ? "^" : "|^") + words[index];
  return new RegExp(text);
}
function byInequality() {
  let text = "";
  for (let index = 0; index < words.length; index++) {
    if (index !== 0) text += "|";
    text += words[index] + "$";
  }
  return new RegExp(text);
}
const made = [byTruth(), byNegation(), byEquality(), byInequality()];
console.log(made.map(each => each.source).join(" "));
console.log(made.map(each => [each.test("gamma"), each.test("a gamma"), each.test("gammaa"), each.test("nothing")].join()).join(" "));

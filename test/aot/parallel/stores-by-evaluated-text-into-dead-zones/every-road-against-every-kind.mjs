// every road by which evaluated text stores, against every kind of binding, in and behind its dead zone
const texts = [
  "late = 2", "[late] = [2]", "({ late } = { late: 2 })", "[late = 3] = []", "[...late] = [2]", "({ ...late } = { a: 2 })", "({ a: late } = { a: 2 })",
  "late += 2", "late **= 2", "late &&= 2", "late ||= 2", "late ??= 2", "late++", "--late",
  "for ([late] of [[5]]);", "for ({ late } of [{ late: 5 }]);", "for ([late] in { a: 5 });",
  "(() => { late = 2; })()", "(function () { late = 2; })()", "eval('late = 2')", "eval('(() => { late = 2; })()')", "new (class { constructor() { late = 2; } })()",
  "late", "typeof late",
];
function attempt(text, evaluate) { try { return "answered " + String(evaluate(text)); } catch (error) { return error.constructor.name; } }
function constant(text) { const seen = attempt(text, (given) => eval(given)); const late = 1; return seen + " | " + late; }
function variable(text) { const seen = attempt(text, (given) => eval(given)); let late = 1; return seen + " | " + late; }
function declaredClass(text) { const seen = attempt(text, (given) => eval(given)); class late {} return seen + " | " + typeof late; }
function initializedConstant(text) { const late = 1; const seen = attempt(text, (given) => eval(given)); return seen + " | " + late; }
function initializedVariable(text) { let late = 1; const seen = attempt(text, (given) => eval(given)); return seen + " | " + String(late); }
for (const text of texts) {
  console.log(text);
  console.log("  a constant in its dead zone: " + constant(text));
  console.log("  a variable in its dead zone: " + variable(text));
  console.log("  a class in its dead zone: " + declaredClass(text));
  console.log("  an initialized constant: " + initializedConstant(text));
  console.log("  an initialized variable: " + initializedVariable(text));
}

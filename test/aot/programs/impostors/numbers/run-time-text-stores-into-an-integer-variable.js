function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const letters = ["a", "b", "c", "d"];

function directEval(text) {
  let index = 0;
  index++;
  eval(text);
  return [index, typeof index, letters[index], index | 0, index + 1];
}

function directEvalInALoop(text) {
  let index = 0;
  const seen = [];
  for (let round = 0; round < 4; round++) {
    seen.push(letters[index]);
    if (round === 1) eval(text);
    index++;
  }
  seen.push(index);
  return seen;
}

function directEvalInAClosure(text) {
  let index = 0;
  const change = source => eval(source);
  index++;
  change(text);
  return [index, letters[index], index & 3];
}

function evalDeclaresAVariableOfTheSameName(text) {
  var index = 1;
  eval(text);
  return [index, letters[index], index | 0];
}

function withStatement(scope) {
  let index = 1;
  with (scope) {
    index = index + 1;
    var seen = [index, letters[index], index | 0];
  }
  return [seen, index, letters[index], scope];
}

const texts = ["index = 2", "index = '2'", "index = 1.5", "index = -0", "index = 2147483648", "index = undefined", "index = null", "index = 2n", "index = NaN", "index = { valueOf() { return 3; } }", "index += '1'", "index /= 2", "index--", "0"];
for (const round of ["cold", "warm"]) {
  for (const text of texts) {
    attempt(round + " directEval " + text, () => directEval(text));
    attempt(round + " directEvalInALoop " + text, () => directEvalInALoop(text));
    attempt(round + " directEvalInAClosure " + text, () => directEvalInAClosure(text));
  }
  for (const text of ["var index = 'x'", "var index = 2.5", "var index", "var other = 1", "function index() {}"]) attempt(round + " evalDeclaresAVariableOfTheSameName " + text, () => evalDeclaresAVariableOfTheSameName(text));
  for (const scope of [{}, { index: 2 }, { index: "2" }, { index: 0.5 }, { letters: ["w", "x", "y", "z"] }, { index: 2147483647 }, { get index() { return 1; }, set index(value) {} }]) attempt(round + " withStatement", () => withStatement(scope));
  for (let i = 0; i < 300; i++) {
    directEval("0");
    directEvalInALoop("0");
    directEvalInAClosure("0");
    withStatement({});
  }
}

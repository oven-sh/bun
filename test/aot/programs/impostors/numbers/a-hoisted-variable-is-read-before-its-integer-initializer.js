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

function readBefore() {
  const early = [index, typeof index, letters[index], index | 0, index + 1];
  var index = 0;
  return [early, index, letters[index]];
}

function declaredTwice() {
  var index;
  const early = [index, letters[index], index & 3, index + 1];
  var index = 2;
  return [early, letters[index]];
}

function initializedInABranch(flag) {
  if (flag) var index = 1;
  return [index, letters[index], index | 0, index + 1, index++, index];
}

function initializedInALoop(rounds) {
  const seen = [];
  for (var round = 0; round < rounds; round++) {
    seen.push(index, letters[index]);
    var index = round;
  }
  return seen;
}

function skippedByASwitch(value) {
  switch (value) {
    case 0:
      var index = 3;
      break;
    case 1:
      return [index, letters[index], index | 0];
  }
  return [index, letters[index], index | 0];
}

function readByAnEarlierClosure() {
  const read = () => [index, letters[index], index | 0];
  const early = read();
  var index = 1;
  return [early, read()];
}

function letReadTooEarly() {
  const read = () => letters[index];
  const early = outcome(read);
  let index = 1;
  index++;
  return [early, read(), index & 3];
}

function neverInitialized() {
  if (letters.length > 100) var index = 1;
  let total = 0;
  for (let i = 0; i < 3; i++) total += index | 0;
  return [total, index, letters[index]];
}

function functionOfTheSameName() {
  const early = typeof index;
  var index = 1;
  function index() {}
  return [early, index, letters[index]];
}

for (let i = 0; i < 2; i++) {
  attempt("readBefore", readBefore);
  attempt("declaredTwice", declaredTwice);
  attempt("initializedInABranch(true)", () => initializedInABranch(true));
  attempt("initializedInABranch(false)", () => initializedInABranch(false));
  attempt("initializedInALoop(3)", () => initializedInALoop(3));
  attempt("skippedByASwitch(0)", () => skippedByASwitch(0));
  attempt("skippedByASwitch(1)", () => skippedByASwitch(1));
  attempt("skippedByASwitch(2)", () => skippedByASwitch(2));
  attempt("readByAnEarlierClosure", readByAnEarlierClosure);
  attempt("letReadTooEarly", letReadTooEarly);
  attempt("neverInitialized", neverInitialized);
  attempt("functionOfTheSameName", functionOfTheSameName);
  for (let j = 0; j < 2000; j++) initializedInABranch(true);
}

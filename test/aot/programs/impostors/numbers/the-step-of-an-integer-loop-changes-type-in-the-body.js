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

function run(steps, limit) {
  const seen = [];
  let step = 1;
  for (let i = 0; i < limit; i += step) {
    seen.push(i);
    if (seen.length in steps) step = steps[seen.length];
    if (seen.length === 12) break;
  }
  return seen;
}

function runWithIncrementAndExtra(extras, limit) {
  const seen = [];
  for (let i = 0; i < limit; i++) {
    seen.push(i);
    if (seen.length in extras) i += extras[seen.length];
    if (seen.length === 12) break;
  }
  return seen;
}

function runReplacingTheCounter(replacements, limit) {
  const seen = [];
  for (let i = 0; i < limit; i++) {
    seen.push(i);
    if (seen.length in replacements) i = replacements[seen.length];
    if (seen.length === 12) break;
  }
  return seen;
}

function runIndexing(replacements, list) {
  const seen = [];
  for (let i = 0; i < list.length; i++) {
    seen.push(list[i]);
    if (seen.length in replacements) i = replacements[seen.length];
    if (seen.length === 12) break;
  }
  return seen;
}

for (let i = 0; i < 500; i++) {
  run({}, 8);
  runWithIncrementAndExtra({}, 8);
  runReplacingTheCounter({}, 8);
  runIndexing({}, [1, 2, 3, 4]);
}

const late = {
  "a half": 0.5,
  "a string": "1",
  "an empty string": "",
  "a bigint": 1n,
  "null": null,
  "undefined": undefined,
  "true": true,
  "NaN": NaN,
  "negative zero": -0,
  "2 ** 31": 2147483648,
  "an object": { valueOf: () => 2 },
  "an array": [2],
  "a symbol": Symbol("s"),
};

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
for (const name of Object.keys(late)) {
  attempt("the step becomes " + name, () => run({ 3: late[name] }, 8));
  attempt("the step becomes " + name + " and an integer again", () => run({ 3: late[name], 5: 1 }, 8));
  attempt("the counter gets " + name + " added", () => runWithIncrementAndExtra({ 3: late[name] }, 8));
  attempt("the counter becomes " + name, () => runReplacingTheCounter({ 3: late[name] }, 8));
  attempt("the index becomes " + name, () => runIndexing({ 3: late[name] }, letters));
}
attempt("an honest run", () => run({ 3: 2 }, 8));

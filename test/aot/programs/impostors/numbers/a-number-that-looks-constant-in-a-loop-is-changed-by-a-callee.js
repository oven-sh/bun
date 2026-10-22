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

function nothing() {}

function capturedVariable(rounds, at, replacement) {
  let factor = 2;
  const change = () => {
    factor = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(factor * 3, factor | 0, factor + 1);
    (i === at ? change : nothing)();
  }
  return seen;
}

function memberOfAnObject(rounds, at, replacement) {
  const holder = { factor: 2 };
  const change = target => {
    target.factor = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(holder.factor * 3, holder.factor | 0, holder.factor + 1);
    (i === at ? change : nothing)(holder);
  }
  return seen;
}

function elementOfAnArray(rounds, at, replacement) {
  const list = [2, 4];
  const change = target => {
    target[0] = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(list[0] * 3, list[0] | 0, list[0] + 1);
    (i === at ? change : nothing)(list);
  }
  return seen;
}

function lengthOfAnArray(rounds, at, replacement) {
  const list = [1, 2, 3, 4];
  const change = target => {
    target.length = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(list.length, list.length - 1, list[list.length - 1]);
    (i === at ? change : nothing)(list);
  }
  return seen;
}

let shared = 2;
function changeShared(value) {
  shared = value;
}

function moduleVariable(rounds, at, replacement) {
  shared = 2;
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(shared * 3, shared | 0, shared + 1);
    if (i === at) changeShared(replacement);
  }
  return seen;
}

function boundOfTheLoop(at, replacement) {
  const limits = { rounds: 6 };
  const change = target => {
    target.rounds = replacement;
  };
  const seen = [];
  for (let i = 0; i < limits.rounds; i++) {
    seen.push(i);
    (i === at ? change : nothing)(limits);
    if (seen.length === 9) break;
  }
  return seen;
}

function memberBehindAGetter(rounds, at, replacement) {
  let reads = 0;
  const holder = {
    get factor() {
      return reads++ > at * 3 + 2 ? replacement : 2;
    },
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) seen.push(holder.factor * 3, holder.factor | 0, holder.factor + 1);
  return seen;
}

function conversionThatChanges(rounds, at, replacement) {
  let calls = 0;
  const factor = { valueOf: () => (calls++ > at * 3 + 2 ? replacement : 2) };
  const seen = [];
  for (let i = 0; i < rounds; i++) seen.push(factor * 3, factor | 0, factor + 1);
  return seen;
}

for (let i = 0; i < 1000; i++) {
  capturedVariable(3, 1, 3);
  memberOfAnObject(3, 1, 3);
  elementOfAnArray(3, 1, 3);
  lengthOfAnArray(3, 1, 3);
  moduleVariable(3, 1, 3);
  boundOfTheLoop(1, 4);
  memberBehindAGetter(3, 1, 3);
  conversionThatChanges(3, 1, 3);
}

for (const replacement of [5, "5", "", 0.5, -0, null, undefined, true, 5n, NaN, 2147483647, 2147483648, [5], { valueOf: () => 5 }, Symbol("s")]) {
  const label = show(replacement);
  attempt("capturedVariable becomes " + label, () => capturedVariable(3, 1, replacement));
  attempt("memberOfAnObject becomes " + label, () => memberOfAnObject(3, 1, replacement));
  attempt("elementOfAnArray becomes " + label, () => elementOfAnArray(3, 1, replacement));
  attempt("moduleVariable becomes " + label, () => moduleVariable(3, 1, replacement));
  attempt("memberBehindAGetter becomes " + label, () => memberBehindAGetter(3, 1, replacement));
  attempt("conversionThatChanges becomes " + label, () => conversionThatChanges(3, 1, replacement));
  attempt("boundOfTheLoop becomes " + label, () => boundOfTheLoop(1, replacement));
}
for (const replacement of [0, 1, 2, 6, "2", 2.5, -1, null, 4294967295]) attempt("lengthOfAnArray becomes " + show(replacement), () => lengthOfAnArray(3, 1, replacement));

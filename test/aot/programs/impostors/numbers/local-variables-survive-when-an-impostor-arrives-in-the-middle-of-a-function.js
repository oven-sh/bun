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

function manyLocals(value, list) {
  let count = 3;
  let ratio = 0.25;
  let label = "label";
  let flag = true;
  let nothing = null;
  let missing;
  let big = 2147483647;
  let negative = -0;
  let object = { member: 1 };
  let items = [1, 2];
  let large = 10n;
  const closure = () => count + ratio;
  count++;
  ratio *= 2;
  label += "!";
  items.push(count);
  object.member += count;
  big++;
  const result = value * 2;
  count++;
  ratio += 1;
  label += "?";
  items.push(count);
  object.member += count;
  large++;
  return [result, count, ratio, label, flag, nothing, missing, big, negative, object, items, large, closure(), list.length];
}

function localsAcrossALoop(list) {
  let sum = 0;
  let product = 1;
  let text = "";
  let last = -1;
  let fractions = 0.5;
  const seen = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    text += i;
    fractions += 0.25;
    sum += item | 0;
    product *= item;
    last = i;
    seen.push(sum);
  }
  return [sum, product, text, last, fractions, seen];
}

function nestedLoops(grid) {
  let total = 0;
  let cells = 0;
  const rows = [];
  for (let y = 0; y < grid.length; y++) {
    let rowTotal = 0;
    for (let x = 0; x < grid[y].length; x++) {
      cells++;
      rowTotal += grid[y][x] * (x + 1);
    }
    rows.push(rowTotal);
    total += rowTotal;
  }
  return [total, cells, rows];
}

function parametersAreReassigned(a, b, c) {
  a = a + 1;
  b = b * 2;
  c = c | 0;
  const first = [a, b, c];
  a += b;
  b -= c;
  c ^= a;
  return [first, a, b, c];
}

function switchInALoop(codes) {
  let state = 0;
  const trail = [];
  for (let i = 0; i < codes.length; i++) {
    switch (codes[i]) {
      case 0:
        state += 1;
        break;
      case 1:
        state *= 2;
      case 2:
        state -= 1;
        break;
      default:
        state = state + codes[i];
    }
    trail.push(state);
  }
  return trail;
}

for (let i = 0; i < 2000; i++) {
  manyLocals(i, [1]);
  localsAcrossALoop([1, 2, 3]);
  nestedLoops([[1, 2], [3, 4]]);
  parametersAreReassigned(i, i, i);
  switchInALoop([0, 1, 2, 3]);
}

const impostors = ["5", "x", 0.5, -0, null, undefined, true, 5n, NaN, 2147483647, [5], { valueOf: () => 5 }, Symbol("s")];
for (const value of impostors) {
  const label = show(value);
  attempt("manyLocals(" + label + ")", () => manyLocals(value, [1]));
  attempt("localsAcrossALoop with " + label, () => localsAcrossALoop([1, 2, value, 4]));
  attempt("nestedLoops with " + label, () => nestedLoops([[1, 2], [3, value], [5, 6]]));
  attempt("parametersAreReassigned first " + label, () => parametersAreReassigned(value, 2, 3));
  attempt("parametersAreReassigned second " + label, () => parametersAreReassigned(1, value, 3));
  attempt("parametersAreReassigned third " + label, () => parametersAreReassigned(1, 2, value));
  attempt("switchInALoop with " + label, () => switchInALoop([0, 1, value, 2, 0]));
}
attempt("honest calls afterwards", () => [manyLocals(1, [1]), localsAcrossALoop([1, 2, 3]), nestedLoops([[1, 2], [3, 4]]), parametersAreReassigned(1, 2, 3), switchInALoop([0, 1, 2, 3])]);

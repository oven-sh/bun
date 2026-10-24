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

function readThenAssigned(value) {
  let n = 1;
  return [n + (n = value), n];
}

function assignedThenRead(value) {
  let n = 1;
  return [(n = value) + n, n];
}

function readThenIncremented(value) {
  let n = value;
  return [n + n++, n];
}

function incrementedThenRead(value) {
  let n = value;
  return [n++ + n, n];
}

function multipliedByItsOwnUpdate(value) {
  let n = value;
  return [n * ++n, n];
}

function compoundWithAnAssignmentInside(value) {
  let n = 1;
  n += n = value;
  return n;
}

function indexUpdatedWhileStoring(value) {
  const list = [0, 0, 0, 0];
  let i = 0;
  list[i++] = i;
  list[i] = i = value;
  return [list.slice(0, 4), Object.keys(list), i];
}

function elementAndIndexInOneExpression(value) {
  const list = [10, 20, 30];
  let i = 0;
  return [list[i] + list[(i = value)], i];
}

function argumentsInOrder(value) {
  let n = 1;
  return [[n, (n = value), n, n++, n]];
}

function conditionAssigns(value) {
  let n = 1;
  const result = (n = value) ? n + 1 : n - 1;
  return [result, n];
}

function commaAssigns(value) {
  let n = 1;
  return [(n++, (n = value), n + 1), n];
}

function shortCircuitSkipsTheStore(value) {
  let n = 0;
  const result = n && (n = value);
  const other = n || (n = value);
  return [result, other, n, n + 1];
}

const uses = [readThenAssigned, assignedThenRead, readThenIncremented, incrementedThenRead, multipliedByItsOwnUpdate, compoundWithAnAssignmentInside, indexUpdatedWhileStoring, elementAndIndexInOneExpression, argumentsInOrder, conditionAssigns, commaAssigns, shortCircuitSkipsTheStore];
for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 3);
for (const use of uses) for (const value of [2, "2", 1.5, -0, 0, null, undefined, true, 2n, NaN, 2147483647, [2], { valueOf: () => 2 }]) attempt(use.name + "(" + show(value) + ")", () => use(value));

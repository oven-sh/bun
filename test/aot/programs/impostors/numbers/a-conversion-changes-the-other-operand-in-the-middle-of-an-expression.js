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

function sumWithACapturedVariable(makeOperand) {
  let n = 1;
  const operand = makeOperand(value => {
    n = value;
  });
  const first = n + operand;
  const second = operand + n;
  return [first, second, n];
}

function sumWithAField(makeOperand) {
  const holder = { n: 1 };
  const operand = makeOperand(value => {
    holder.n = value;
  });
  const first = holder.n + operand;
  const second = operand + holder.n;
  return [first, second, holder.n];
}

function sumWithAnElement(makeOperand) {
  const list = [1, 2, 3];
  const operand = makeOperand(value => {
    list[0] = value;
  });
  const first = list[0] + operand;
  const second = operand + list[0];
  return [first, second, list];
}

function compoundOnACapturedVariable(makeOperand) {
  let n = 1;
  const operand = makeOperand(value => {
    n = value;
  });
  n += operand;
  return n;
}

function compoundOnAField(makeOperand) {
  const holder = { n: 1 };
  const operand = makeOperand(value => {
    holder.n = value;
  });
  holder.n *= operand;
  return holder.n;
}

function compoundOnAnElement(makeOperand) {
  const list = [1, 2, 3];
  const operand = makeOperand(value => {
    list[0] = value;
    list.length = 1;
  });
  list[0] -= operand;
  return list;
}

function comparison(makeOperand) {
  let n = 1;
  const operand = makeOperand(value => {
    n = value;
  });
  return [n < operand, operand < n, n];
}

function loopBound(makeOperand) {
  let step = 1;
  const bound = makeOperand(value => {
    step = value;
  });
  const seen = [];
  for (let i = 0; i < bound; i += step) {
    seen.push(i);
    if (seen.length === 6) break;
  }
  return seen;
}

function indexAndElement(makeOperand) {
  const list = [10, 20, 30];
  const index = makeOperand(value => {
    list[1] = value;
  });
  return [list[+index % 3], list[1]];
}

const uses = [sumWithACapturedVariable, sumWithAField, sumWithAnElement, compoundOnACapturedVariable, compoundOnAField, compoundOnAnElement, comparison, loopBound, indexAndElement];
const honest = () => 4;
for (let i = 0; i < 1000; i++) for (const use of uses) use(honest);
for (const stored of [7, "7", 0.5, -0, undefined, null, 7n, NaN, 2147483647, [7]]) {
  const makeOperand = change => ({
    valueOf() {
      change(stored);
      return 4;
    },
  });
  for (const use of uses) attempt(use.name + " while the conversion stores " + show(stored), () => use(makeOperand));
}
for (const use of uses) attempt(use.name + " with a plain number", () => use(honest));

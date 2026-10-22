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

function variable(start) {
  let n = start | 0;
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(n--);
  seen.push(n);
  return seen;
}

function variableBefore(start) {
  let n = start | 0;
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(--n);
  return seen;
}

function field(start) {
  const holder = { n: start | 0 };
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(--holder.n);
  return seen;
}

function element(start) {
  const list = [start | 0, 1, 2];
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(--list[0]);
  seen.push(list);
  return seen;
}

function captured(start) {
  let n = start | 0;
  const previous = () => --n;
  return [previous(), previous(), previous(), n];
}

function minusAssign(start) {
  let n = start | 0;
  n -= 1;
  n -= 1;
  n -= 1;
  return [n, n | 0, n >>> 0];
}

function countdownToZero(start) {
  let n = start | 0;
  let steps = 0;
  while (n-- > 0) steps++;
  return [steps, n];
}

const uses = [variable, variableBefore, field, element, captured, minusAssign];
for (let i = 0; i < 2000; i++) for (const use of uses) use(i);
for (const use of uses) {
  attempt(use.name + " from 5", () => use(5));
  attempt(use.name + " from -2147483646", () => use(-2147483646));
  attempt(use.name + " from -2147483648", () => use(-2147483648));
  attempt(use.name + " from 1", () => use(1));
}
attempt("countdownToZero from 3", () => countdownToZero(3));
attempt("countdownToZero from 0", () => countdownToZero(0));
attempt("countdownToZero from -2147483648", () => countdownToZero(-2147483648));

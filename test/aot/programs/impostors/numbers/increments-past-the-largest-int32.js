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
  for (let i = 0; i < 4; i++) seen.push(n++);
  seen.push(n);
  return seen;
}

function variableBefore(start) {
  let n = start | 0;
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(++n);
  return seen;
}

function field(start) {
  const holder = { n: start | 0 };
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(holder.n++);
  seen.push(holder.n);
  return seen;
}

function element(start) {
  const list = [start | 0, 1, 2];
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(list[0]++);
  seen.push(list[0], list);
  return seen;
}

function captured(start) {
  let n = start | 0;
  const next = () => n++;
  return [next(), next(), next(), next(), n];
}

class Ticket {
  static last = 0;
  static next() {
    return ++Ticket.last;
  }
}

function classStatic(start) {
  Ticket.last = start | 0;
  return [Ticket.next(), Ticket.next(), Ticket.next(), Ticket.last];
}

let moduleCounter = 0;

function moduleVariable(start) {
  moduleCounter = start | 0;
  return [moduleCounter++, moduleCounter++, moduleCounter++, moduleCounter];
}

function typedElement(start) {
  const list = new Int32Array([start | 0]);
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(list[0]++);
  seen.push(list[0]);
  return seen;
}

function plusOne(start) {
  let n = start | 0;
  n = n + 1;
  n = n + 1;
  n = n + 1;
  return [n, n | 0, n >>> 0];
}

const uses = [variable, variableBefore, field, element, captured, classStatic, moduleVariable, typedElement, plusOne];
for (let i = 0; i < 2000; i++) for (const use of uses) use(i);
for (const use of uses) {
  attempt(use.name + " from 5", () => use(5));
  attempt(use.name + " from 2147483645", () => use(2147483645));
  attempt(use.name + " from 2147483647", () => use(2147483647));
  attempt(use.name + " from -2", () => use(-2));
  attempt(use.name + " from 5 again", () => use(5));
}

// A number field is stored to through a wider alias.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Reading {
  unit = "C";
  value = 1.5;
  count = 1;
  doubled(): number {
    return this.value * 2;
  }
  next(): number {
    return this.count + 1;
  }
  text(): string {
    return this.value.toFixed(1);
  }
}

function doubled(box: { value: number }): number {
  return box.value * 2;
}

function plusOne(box: { value: number }): number {
  return box.value + 1;
}

function asInteger(box: { value: number }): number {
  return box.value | 0;
}

function isPositive(box: { value: number }): boolean {
  return box.value > 0;
}

function kind(box: { value: number }): string {
  return typeof box.value;
}

function bump(box: { value: number }): number {
  box.value++;
  return box.value;
}

const log: string[] = [];
function put<T>(box: { value: number | T }, value: T): void {
  box.value = value;
}

const ways: [string, (box: { value: number }) => void][] = [
  ["the text 7", box => put(box, "7")],
  ["a word", box => put(box, "word")],
  ["an empty string", box => put(box, "")],
  ["undefined", box => put(box, undefined)],
  ["null", box => put(box, null)],
  ["true", box => put(box, true)],
  ["a bigint", box => put(box, 7n)],
  ["a symbol", box => put(box, Symbol("s"))],
  ["an object with valueOf", box => put(box, { valueOf: () => (log.push("valueOf"), 7) })],
  ["an array of one number", box => put(box, [7])],
  ["a built-in function", box => put(box, Math.max)],
  ["an honest number", box => put(box, 7)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const literal = { value: i + 0.5 };
  const reading = new Reading();
  warm += doubled(literal) + plusOne(literal) + asInteger(literal) + (isPositive(literal) ? 1 : 0) + kind(literal).length + bump(literal);
  warm += doubled(reading) + reading.doubled() + reading.next() + reading.text().length + bump(reading);
}
console.log("after 2000 honest boxes", warm);

for (const [name, store] of ways) {
  for (const [shape, make] of [["literal", () => ({ value: 1.5 })], ["instance", () => new Reading()]] satisfies [string, () => { value: number }][]) {
    const stored = () => {
      const box = make();
      store(box);
      return box;
    };
    attempt(name + " in a " + shape + ": typeof", () => kind(stored()));
    attempt(name + " in a " + shape + ": * 2", () => doubled(stored()));
    attempt(name + " in a " + shape + ": + 1", () => plusOne(stored()));
    attempt(name + " in a " + shape + ": | 0", () => asInteger(stored()));
    attempt(name + " in a " + shape + ": > 0", () => isPositive(stored()));
    attempt(name + " in a " + shape + ": ++", () => bump(stored()));
    attempt(name + " in a " + shape + ": the value", () => stored().value);
  }
  attempt(name + ": the instance's own methods", () => {
    const reading = new Reading();
    store(reading);
    return [reading.unit, reading.doubled(), reading.next(), reading.count];
  });
  attempt(name + ": toFixed", () => {
    const reading = new Reading();
    store(reading);
    return reading.text();
  });
  attempt(name + ": JSON", () => {
    const reading = new Reading();
    store(reading);
    return JSON.stringify(reading);
  });
}
console.log("calls of valueOf", log.length);
attempt("an integer field gets a fraction, then a string", () => {
  const reading = new Reading();
  const wide: { count: number | string } = reading;
  const seen: unknown[] = [reading.next()];
  wide.count = 2.5;
  seen.push(reading.next());
  wide.count = "3";
  seen.push(reading.next(), reading.value, reading.unit);
  return seen;
});

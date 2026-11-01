// A primitive is this of a function with a declared this.
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

type HasLength = { length: number };

function size(this: HasLength): number {
  return this.length;
}

function kind(this: HasLength): string {
  return typeof this;
}

function isTheSame(this: HasLength, other: HasLength): boolean {
  return this === other;
}

function sizeInALoop(this: HasLength, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) total += this.length;
  return total;
}

function grow(this: HasLength): number {
  this.length = this.length + 1;
  return this.length;
}

function fixed(this: { toFixed(digits: number): string }): string {
  return typeof this + " " + this.toFixed(1);
}

function later(this: HasLength): () => number {
  return () => this.length;
}

const values: [string, () => HasLength][] = [
  ["literal", () => ({ length: 4 })],
  ["string", () => "hello"],
  ["empty string", () => ""],
  ["array", () => [1, 2]],
  ["function", () => size],
  ["typed array", () => new Uint8Array(3)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += size.call(honest) + kind.call(honest).length + (isTheSame.call(honest, honest) ? 1 : 0) + sizeInALoop.call(honest, 2) + grow.call(honest) + later.call(honest)();
}
console.log("after 2000 literals", warm);

for (const [name, make] of values) {
  attempt(name + ": call", () => size.call(make()));
  attempt(name + ": apply", () => size.apply(make()));
  attempt(name + ": bind", () => size.bind(make())());
  attempt(name + ": Reflect.apply", () => Reflect.apply(size, make(), []));
  attempt(name + ": typeof this", () => kind.call(make()));
  attempt(name + ": this is the value", () => {
    const value = make();
    return isTheSame.call(value, value);
  });
  attempt(name + ": in a loop", () => sizeInALoop.call(make(), 3));
  attempt(name + ": a store to this", () => grow.call(make()));
  attempt(name + ": captured by an arrow function", () => later.call(make())());
  attempt(name + ": as a method of a holder", () => {
    const holder = { length: 99, size };
    return [holder.size(), holder.size.call(make())];
  });
}
attempt("numbers as this", () => [fixed.call(1), fixed.call(2.5), fixed.call(-0), fixed.call(new Number(3)), fixed.call({ toFixed: () => "own" })]);
attempt("this from forEach", () => {
  const seen: string[] = [];
  [1].forEach(function (this: HasLength) {
    seen.push(typeof this + " " + this.length);
  }, "abc");
  [1].forEach(function (this: HasLength) {
    seen.push(typeof this + " " + this.length);
  }, { length: 7 });
  return seen;
});

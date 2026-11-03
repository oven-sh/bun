function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

function unlock<T>(target: T): { -readonly [K in keyof T]: T[K] } {
  return target;
}

class Limits {
  readonly max = 10;
  readonly ratio = 0.5;
  readonly unit: string = "ms";
  static readonly DEFAULT = 3;
  room(used: number): number {
    return this.max - used;
  }
  scaled(): number {
    return this.max * this.ratio;
  }
  text(): string {
    return this.max + this.unit;
  }
}

interface Frozen {
  readonly id: number;
  readonly tags: readonly string[];
}

function report(title: string, l: Limits): void {
  console.log(title + ": " + JSON.stringify(l) + " " + l.max + " " + l.ratio + " " + l.unit);
  attempt("  room(1)", () => l.room(1));
  attempt("  scaled", () => l.scaled());
  attempt("  text", () => l.text());
  attempt("  max === 10", () => l.max === 10);
}

const limits = new Limits();
let total = 0;
for (let i = 0; i < 2000; i++) total += limits.room(i) + limits.scaled() + limits.text().length;
console.log("2000 honest rounds: " + total);
report("before", limits);

const open = unlock(limits);
console.log("the same object: " + Object.is(open, limits));
attempt("the literal type of max allows 10 only", () => {
  open.max = 10;
  return limits.max;
});
open.unit = "s";
report("the unit is stored to", limits);

const numbers: { max: number; ratio: number } = unlock(limits);
numbers.max = 99;
numbers.ratio = 2;
report("max and ratio through a wider view", limits);
report("a fresh one", new Limits());

const statics: { DEFAULT: number } = unlock(Limits);
statics.DEFAULT = 4;
console.log("a static readonly member: " + Limits.DEFAULT + " " + (Limits.DEFAULT + 1) + " " + (Limits.DEFAULT === 3));

const frozen: Frozen = { id: 1, tags: ["a"] };
const thawed = unlock(frozen);
thawed.id = 2;
thawed.tags = ["b", "c"];
console.log("a literal behind an interface: " + JSON.stringify(frozen) + " " + (frozen.id + 1) + " " + frozen.tags.length);

const ice = { id: 1, name: "ice" };
const really = Object.freeze(ice);
attempt("an object that is really frozen", () => {
  unlock(really).id = 2;
  return really.id;
});
console.log("after the attempt: " + JSON.stringify(really));

const tuple: readonly [number, string] = [1, "a"];
const mutable = unlock(tuple);
mutable[0] = 5;
mutable[1] = "z";
console.log("a readonly tuple: " + show(tuple) + " " + (tuple[0] + 1) + " " + tuple[1].toUpperCase());
const list: readonly number[] = [1, 2, 3];
const writable = unlock(list);
writable[0] = 0.5;
writable.push(4);
console.log("a readonly list: " + show(list) + " " + list.length + " " + (list[0] + list[3]));

export {};

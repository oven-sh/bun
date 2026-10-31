// Booleans bigints and symbols under object types.
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

type Localized = { toLocaleString(): string };
type Comparable = { valueOf(): unknown; toString(): string };

class Holder<T extends {}> {
  history: T[] = [];
  constructor(public current: T) {}
  put(next: T): T {
    this.history.push(this.current);
    this.current = next;
    return this.current;
  }
}

function kindAndText(value: Comparable): string {
  return typeof value + " " + String(value.valueOf() === value) + " " + value.toString();
}

function localKind(value: Localized): string {
  return typeof value + " " + typeof value.toLocaleString();
}

function asKey(value: {}): string {
  const record: Record<string, number> = {};
  record[String(value)] = 1;
  return Object.keys(record)[0];
}

function inATemplate(value: {}): string {
  return `[${value}]`;
}

function added(value: {}): string {
  return value + "!";
}

const values: [string, Comparable & Localized][] = [
  ["a literal", { valueOf: () => 0, toString: () => "literal", toLocaleString: () => "local" }],
  ["true", true],
  ["false", false],
  ["0n", 0n],
  ["-5n", -5n],
  ["2n ** 100n", 2n ** 100n],
  ["a symbol", Symbol("mark")],
  ["a symbol without a description", Symbol()],
  ["a well-known symbol", Symbol.asyncIterator],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { valueOf: () => i, toString: () => "t" + i };
  warm += kindAndText(honest).length + localKind(honest).length + asKey(honest).length + inATemplate(honest).length + added(honest).length + new Holder(honest).put(honest).valueOf();
}
console.log("after 2000 literals", warm);

for (const [name, value] of values) {
  attempt(name + ": kind and text", () => kindAndText(value));
  attempt(name + ": local", () => localKind(value));
  attempt(name + ": as a key", () => asKey(value));
  attempt(name + ": in a template", () => inATemplate(value));
  attempt(name + ": added to a string", () => added(value));
  attempt(name + ": in a holder", () => {
    const holder = new Holder<{}>({});
    holder.put(value);
    holder.put(0);
    holder.put(value);
    return [holder.current, holder.history];
  });
}
attempt("a holder of booleans", () => {
  const holder = new Holder(true);
  holder.put(false);
  return [holder.current, holder.history, holder.current ? "truthy" : "falsy"];
});
attempt("a holder of bigints", () => {
  const holder = new Holder(1n);
  holder.put(holder.current + 2n ** 64n);
  return [holder.current, holder.history, holder.current * 2n];
});
attempt("a holder of symbols", () => {
  const holder = new Holder(Symbol.for("a"));
  holder.put(Symbol.for("b"));
  return [holder.current.description, holder.history[0] === Symbol.for("a")];
});

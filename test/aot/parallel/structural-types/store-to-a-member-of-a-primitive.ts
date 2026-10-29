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

function setLength(item: HasLength, size: number): number {
  item.length = size;
  return item.length;
}

function increment(item: HasLength): number {
  item.length++;
  return item.length;
}

function addTwo(item: HasLength): number {
  item.length += 2;
  return item.length;
}

function byPattern(item: HasLength): number {
  ({ size: item.length } = { size: 1 });
  return item.length;
}

function byAssign(item: HasLength): number {
  Object.assign(item, { length: 1 });
  return item.length;
}

function rename(item: { name: string }): string {
  item.name = "renamed";
  return item.name;
}

function describeAgain(item: { description?: string }): string | undefined {
  item.description = "changed";
  return item.description;
}

function forget(item: { length?: number }): boolean {
  return delete item.length;
}

const makers: [string, () => HasLength][] = [
  ["literal", () => ({ length: 5 })],
  ["string", () => "hello"],
  ["empty string", () => ""],
  ["array", () => [1, 2, 3, 4, 5]],
  ["function", () => function (a: number) { return a; }],
  ["class", () => class { constructor(a: number) {} }],
  ["typed array", () => new Uint8Array(5)],
  ["String object", () => new String("boxed")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += setLength({ length: i }, 1) + increment({ length: i }) + addTwo({ length: i }) + byPattern({ length: i }) + byAssign({ length: i });
  warm += rename({ name: "n" }).length + (forget({ length: i }) ? 1 : 0);
}
console.log("after 2000 literals", warm);

for (const [name, make] of makers) {
  attempt(name + ": store 2", () => {
    const item = make();
    return [setLength(item, 2), item];
  });
  attempt(name + ": store its own length", () => {
    const item = make();
    return setLength(item, item.length);
  });
  attempt(name + ": ++", () => increment(make()));
  attempt(name + ": += 2", () => addTwo(make()));
  attempt(name + ": a destructuring target", () => byPattern(make()));
  attempt(name + ": Object.assign", () => byAssign(make()));
  attempt(name + ": delete", () => forget(make()));
  attempt(name + ": unchanged after a failed store", () => {
    const item = make();
    const before = item.length;
    try {
      setLength(item, 1);
    } catch {}
    return [before, item.length];
  });
}
attempt("rename a literal", () => rename({ name: "old" }));
attempt("rename a function", () => rename(function old() {}));
attempt("rename a class", () => rename(class Old {}));
attempt("describe a literal", () => describeAgain({}));
attempt("describe a symbol", () => describeAgain(Symbol("old")));
attempt("the symbol keeps its description", () => {
  const symbol = Symbol("old");
  try {
    describeAgain(symbol);
  } catch {}
  return symbol.description;
});

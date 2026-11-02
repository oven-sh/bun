// Each of these tests is decided by the declared type of what it tests: a parameter, a variable, a field, an element. Values of every other kind arrive, and the test answers for the value that is there, as in plain Bun.
const lines: string[] = [];
class Point {
  x = 1;
  text = "point";
}
class Other {
  y = 2;
  text = "other";
}
function kind(value: unknown): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value === "object"
        ? (value as object).constructor.name
        : typeof value;
}

function show(value: unknown): string {
  return typeof value === "function" ? "function" : String(value);
}

function byTypeof(x: string): string {
  if (typeof x !== "string") return "no string: " + kind(x);
  return "string";
}
function byTypeofNumber(x: string): string {
  if (typeof x === "number") return "a number";
  if (typeof x === "object") return "an object or null";
  if (typeof x === "boolean") return "a boolean";
  if (typeof x === "undefined") return "undefined";
  return "else " + typeof x;
}
function byInstance(p: Point): string {
  if (p instanceof Other) return "Other";
  if (!(p instanceof Point)) return "no Point: " + kind(p);
  return "Point";
}
function byNull(p: Point | null): string {
  if (p === null) return "null";
  if (p === undefined) return "undefined";
  return "there: " + kind(p);
}
function byTruth(p: Point): string {
  return p ? "true" : "false";
}
function byTruthOfNumber(n: number): string {
  return n ? "true" : "false";
}
function byOptional(p: Point | undefined): unknown {
  return p?.text;
}
function byDefault(s: string | null): unknown {
  return s ?? "default";
}
function byArray(list: string[]): string {
  return Array.isArray(list) ? "array" : "no array: " + kind(list);
}
function byEquality(s: "a" | "b"): string {
  return s === "a" ? "a" : s === "b" ? "b" : "neither: " + kind(s);
}
function byIn(p: Point): string {
  try {
    return "x" in p ? "has x" : "lacks x";
  } catch {
    return "threw";
  }
}
function bySwitch(n: 1 | 2): string {
  switch (n) {
    case 1:
      return "one";
    case 2:
      return "two";
  }
  return "none: " + kind(n);
}

const functions: [string, (value: any) => unknown][] = [
  ["byTypeof", byTypeof],
  ["byTypeofNumber", byTypeofNumber],
  ["byInstance", byInstance],
  ["byNull", byNull],
  ["byTruth", byTruth],
  ["byTruthOfNumber", byTruthOfNumber],
  ["byOptional", byOptional],
  ["byDefault", byDefault],
  ["byArray", byArray],
  ["byEquality", byEquality],
  ["byIn", byIn],
  ["bySwitch", bySwitch],
];
const values: unknown[] = [
  "a",
  "",
  "text",
  1,
  0,
  2.5,
  NaN,
  true,
  false,
  null,
  undefined,
  new Point(),
  new Other(),
  [],
  ["a"],
  {},
  10n,
  0n,
  Symbol.iterator,
  kind,
];
for (const [name, run] of functions) lines.push(name + ": " + values.map(value => show(run(value))).join(" | "));

lines.push((byTypeof as any)(new Point()), (byTypeof as any)(7), byTypeof("own"));
lines.push((byInstance as any)(new Other()), (byInstance as any)("text"), byInstance(new Point()));
lines.push((byTruth as any)(0), (byTruth as any)(""), byTruth(new Point()));
lines.push((byNull as any)(undefined), (byNull as any)(0), byNull(null));

function make(which: number): any {
  return which === 0 ? "text" : which === 1 ? new Point() : which === 2 ? 7 : which === 3 ? null : undefined;
}
for (let which = 0; which < 5; which++) {
  const s: string = make(which);
  lines.push("a variable " + which + ": " + (typeof s !== "string" ? "no string: " + kind(s) : "string"));
  const p: Point = make(which);
  lines.push("a variable " + which + ": " + (p instanceof Point ? "Point" : "no Point: " + kind(p)));
  const n: number = make(which);
  lines.push("a variable " + which + ": " + (typeof n === "number" ? "number" : "no number: " + kind(n)));
}
class Holder {
  name: string = "held";
  point: Point = new Point();
  count: number = 1;
}
for (let which = 0; which < 5; which++) {
  const holder = new Holder();
  (holder as any).name = make(which);
  (holder as any).point = make(which);
  (holder as any).count = make(which);
  lines.push(
    "a field " + which + ": " + (typeof holder.name !== "string" ? "no string: " + kind(holder.name) : "string"),
  );
  lines.push("a field " + which + ": " + (holder.point instanceof Point ? "Point" : "no Point: " + kind(holder.point)));
  lines.push(
    "a field " + which + ": " + (typeof holder.count === "number" ? "number" : "no number: " + kind(holder.count)),
  );
}
const list: string[] = [];
for (let which = 0; which < 5; which++) (list as any).push(make(which));
for (const s of list) lines.push("an element: " + (typeof s !== "string" ? "no string: " + kind(s) : "string"));
console.log(lines.join("\n"));

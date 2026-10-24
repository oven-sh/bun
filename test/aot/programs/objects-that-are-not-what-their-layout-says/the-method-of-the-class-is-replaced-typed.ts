// The method and the getter of the class are replaced between two rounds of the same reads. A function reads a field that most objects get late, and then relies on what lies above the object or beside the slot.
class A { x = 1; extra?: unknown; second?: unknown; third?: unknown; m(): string { return "A.m"; } get g(): string { return "A.g"; } }
const readers: [string, (o: A) => string][] = [
  ["late field, then a method", function (o: A) { return o.extra + " " + o.m(); }],
  ["late field, then a getter", function (o: A) { return o.extra + " " + o.g; }],
  ["late field, then an absent name", function (o: A) { return o.extra + " " + (o as any).missing; }],
  ["late field, then another late field", function (o: A) { return o.extra + " " + o.second; }],
  ["late field, then `in`", function (o: A) { return o.extra + " " + ("missing" in o) + " " + ("extra" in o); }],
  ["late field twice round a method", function (o: A) { return o.extra + " " + o.m() + " " + o.extra; }],
  ["a method, then the late field", function (o: A) { return o.m() + " " + o.extra; }],
  ["an absent name, then the late field", function (o: A) { return (o as any).missing + " " + o.extra; }],
  ["two late fields, then a method and a field of the constructor", function (o: A) { return o.extra + " " + o.second + " " + o.m() + " " + o.x; }],
  ["late field, then a store that creates a field", function (o: A) { const before = o.extra; o.third = 3; return before + " " + o.third + " " + Object.keys(o).join(); }],
];
const states = ["filled", "empty", "holds undefined", "deleted"];
function fill(o: any, state: string): A {
  try {
    if (state !== "empty") { o.extra = state === "filled" ? 7 : undefined; o.second = state === "filled" ? "two" : undefined; }
    if (state === "deleted") { delete o.extra; delete o.second; }
  } catch {}
  return o;
}
function tell(reader: (o: A) => string, o: A) { try { return reader(o); } catch (error) { return (error as Error).constructor.name; } }
for (const round of ["before", "after"]) {
  for (const [title, reader] of readers)
    for (const state of states)
      console.log(round + ", " + title + ", " + state + ": " + tell(reader, fill(new A(), state)));
  A.prototype.m = function () { return "replaced m"; }; Object.defineProperty(A.prototype, "g", { get() { return "replaced g"; }, configurable: true });
}

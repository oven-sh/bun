// The programs of objects-that-are-not-what-their-layout-says that are one text but for a few places.
import { family, programsOf } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `a-literal-with-the-same-names.js	An object literal has the names of the class and a method of its own	({ x: 1, m() { return "literal.m"; }, get g() { return "literal.g"; }, missing: "literal.missing" }
frozen.js	The object is frozen before the late fields are stored: the stores throw in strict code and the fields stay absent	Object.freeze(new A()
made-by-object-create.js	Object.create makes an object below the prototype object of the class: the constructor has not run	Object.create(A.prototype
put-below-null.js	An instance is put below null: it has no method, and nothing answers for a name that it leaves out	Object.setPrototypeOf(new A(), null`,
      (
        a,
        b,
      ) => `// ${a}. A function reads a field that most objects get late, and then relies on what lies above the object or beside the slot.
class A { constructor() { this.x = 1; } m() { return "A.m"; } get g() { return "A.g"; } }
const readers = [
  ["late field, then a method", function (o) { return o.extra + " " + o.m(); }],
  ["late field, then a getter", function (o) { return o.extra + " " + o.g; }],
  ["late field, then an absent name", function (o) { return o.extra + " " + o.missing; }],
  ["late field, then another late field", function (o) { return o.extra + " " + o.second; }],
  ["late field, then \`in\`", function (o) { return o.extra + " " + ("missing" in o) + " " + ("extra" in o); }],
  ["late field twice round a method", function (o) { return o.extra + " " + o.m() + " " + o.extra; }],
  ["a method, then the late field", function (o) { return o.m() + " " + o.extra; }],
  ["an absent name, then the late field", function (o) { return o.missing + " " + o.extra; }],
  ["two late fields, then a method and a field of the constructor", function (o) { return o.extra + " " + o.second + " " + o.m() + " " + o.x; }],
  ["late field, then a store that creates a field", function (o) { const before = o.extra; o.third = 3; return before + " " + o.third + " " + Object.keys(o).join(); }],
];
const states = ["filled", "empty", "holds undefined", "deleted"];
function fill(o, state) {
  try {
    if (state !== "empty") { o.extra = state === "filled" ? 7 : undefined; o.second = state === "filled" ? "two" : undefined; }
    if (state === "deleted") { delete o.extra; delete o.second; }
  } catch {}
  return o;
}
function tell(reader, o) { try { return reader(o); } catch (error) { return error.constructor.name; } }
for (const [title, reader] of readers)
  for (const state of states)
    console.log(title + ", " + state + ": " + tell(reader, fill(new A(), state)) + " | " + tell(reader, fill(${b}), state)));
`,
    ),
    ...family(
      `a-literal-with-the-same-names-typed.ts	An object literal has the names of the class and a method of its own	({ x: 1, m() { return "literal.m"; }, get g() { return "literal.g"; }, missing: "literal.missing" }
frozen-typed.ts	The object is frozen before the late fields are stored: the stores throw in strict code and the fields stay absent	Object.freeze(new A()
made-by-object-create-typed.ts	Object.create makes an object below the prototype object of the class: the constructor has not run	Object.create(A.prototype
put-below-null-typed.ts	An instance is put below null: it has no method, and nothing answers for a name that it leaves out	Object.setPrototypeOf(new A(), null`,
      (
        a,
        b,
      ) => `// ${a}. A function reads a field that most objects get late, and then relies on what lies above the object or beside the slot.
class A { x = 1; extra?: unknown; second?: unknown; third?: unknown; m(): string { return "A.m"; } get g(): string { return "A.g"; } }
const readers: [string, (o: A) => string][] = [
  ["late field, then a method", function (o: A) { return o.extra + " " + o.m(); }],
  ["late field, then a getter", function (o: A) { return o.extra + " " + o.g; }],
  ["late field, then an absent name", function (o: A) { return o.extra + " " + (o as any).missing; }],
  ["late field, then another late field", function (o: A) { return o.extra + " " + o.second; }],
  ["late field, then \`in\`", function (o: A) { return o.extra + " " + ("missing" in o) + " " + ("extra" in o); }],
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
for (const [title, reader] of readers)
  for (const state of states)
    console.log(title + ", " + state + ": " + tell(reader, fill(new A(), state)) + " | " + tell(reader, fill(${b}), state)));
`,
    ),
  });

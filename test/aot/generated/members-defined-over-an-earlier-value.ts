// An object gets a function, a class or an accessor under a name that already holds something else, and the object is changed or listed before anybody reads the member.
// The name of a case: how the earlier value got there, what it is, what is defined over it, how often the code that makes the object runs, and what happens to the object.
//
//   bun members-defined-over-an-earlier-value.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/over-<earlier>-<runs>.mjs.
import { writeCaseFiles, type CaseFile } from "./case-files";

const values = [
  { name: "number", text: "2" },
  { name: "boolean", text: "true" },
  { name: "text", text: `"earlier"` },
  { name: "null", text: "null" },
  { name: "object", text: "{ tag: 1 }" },
];

/** `inLiteral` is a member of an object literal. `statement` gives `o` the same member. */
const members = [
  { name: "method", inLiteral: "f() { return 7; }", statement: "o.f = { f() { return 7; } }.f;" },
  { name: "arrow", inLiteral: "f: () => 7", statement: "o.f = () => 7;" },
  { name: "function", inLiteral: "f: function () { return 7; }", statement: "o.f = function () { return 7; };" },
  { name: "class", inLiteral: "f: class { static tag = 7; }", statement: "o.f = class { static tag = 7; };" },
  { name: "getter", inLiteral: "get f() { return 7; }", statement: `Object.defineProperty(o, "f", { get() { return 7; }, enumerable: true, configurable: true });` },
  { name: "setter", inLiteral: "set f(v) { this.v = v; }", statement: `Object.defineProperty(o, "f", { set(v) { this.v = v; }, enumerable: true, configurable: true });` },
];

/** Each defines `make`. `VALUE` stands for the earlier value, `MEMBER` for the member in a literal, `STATEMENT` for the statement that gives it to `o`. */
const earlier = [
  { name: "spread", text: "const source = { f: VALUE }; const make = () => ({ v: 1, ...source, MEMBER, w: 2 });" },
  { name: "spread-of-frozen", text: "const source = Object.freeze({ u: 3, f: VALUE }); const make = () => ({ ...source, MEMBER });" },
  { name: "spread-of-parsed", text: "const source = JSON.parse(JSON.stringify({ f: VALUE })); const make = () => ({ v: 1, ...source, MEMBER, w: 2 });" },
  { name: "spread-of-literal", text: "const make = () => ({ v: 1, ...{ f: VALUE }, MEMBER, w: 2 });" },
  { name: "duplicate-key", text: "const make = () => ({ v: 1, f: VALUE, MEMBER, w: 2 });" },
  { name: "computed-key", text: "const make = () => ({ v: 1, [key]: VALUE, MEMBER, w: 2 });" },
  { name: "prototype-in-literal", text: "const make = () => ({ v: 1, __proto__: { f: VALUE }, MEMBER, w: 2 });" },
  { name: "getter", text: "const make = () => ({ v: 1, get f() { return VALUE; }, MEMBER, w: 2 });" },
  { name: "assign", text: "const source = { f: VALUE }; const make = () => { const o = { v: 1 }; Object.assign(o, source); STATEMENT o.w = 2; return o; };" },
  { name: "store", text: "const make = () => { const o = { v: 1 }; o.f = VALUE; STATEMENT o.w = 2; return o; };" },
  { name: "store-by-key", text: "const make = () => { const o = { v: 1 }; o[key] = VALUE; STATEMENT o.w = 2; return o; };" },
  { name: "definition", text: `const make = () => { const o = { v: 1 }; Object.defineProperty(o, "f", { value: VALUE, writable: true, enumerable: true, configurable: true }); STATEMENT o.w = 2; return o; };` },
  { name: "class-field", text: "class C { v = 1; f = VALUE; constructor() { const o = this; STATEMENT o.w = 2; } } const make = () => new C();" },
];

const runs = [
  { name: "once", text: "const o = make();" },
  { name: "twice", text: "const other = make(), o = make();" },
  { name: "hot", text: "let o; for (let i = 0; i < 100; i++) o = make();" },
];

const events = [
  { name: "read", text: "o.f" },
  { name: "deleted", text: "(delete o.f, o.f)" },
  { name: "deleted-with-a-default", text: `(delete o.f, o.f ?? "default")` },
  { name: "deleted-twice", text: "[delete o.f, o.f, delete o.f, o.f]" },
  { name: "deleted-and-asked-for", text: `(delete o.f, ["f" in o, Object.hasOwn(o, "f"), o.f])` },
  { name: "deleted-and-listed", text: "(delete o.f, [Object.keys(o).join(), o.f])" },
  { name: "deleted-and-copied", text: "(delete o.f, { ...o }.f)" },
  { name: "deleted-and-stored-again", text: "(delete o.f, o.f = 5, [o.f, Object.keys(o).join()])" },
  { name: "cleared-and-deleted", text: "(o.f = null, delete o.f, o.f)" },
  { name: "given-a-number", text: "(o.f = 5, [o.f, o.v, Object.keys(o).join()])" },
  { name: "given-null", text: "(o.f = null, [o.f, o.v])" },
  { name: "given-a-function", text: "(o.f = () => 8, [typeof o.f, o.v])" },
  { name: "given-a-number-by-key", text: "(o[key] = 5, [o.f, o.v, Object.keys(o).join()])" },
  { name: "given-a-number-by-reflection", text: `(Reflect.set(o, "f", 5), [o.f, o.v])` },
  { name: "given-a-number-by-a-copy", text: "(Object.assign(o, { f: 5 }), [o.f, o.v])" },
  { name: "given-a-number-by-key-and-deleted", text: "(o[key] = 5, delete o.f, o.f)" },
  { name: "given-a-number-by-key-then-a-function-and-deleted", text: "(o[key] = 5, o.f = () => 8, delete o.f, o.f)" },
  { name: "redefined", text: `(Object.defineProperty(o, "f", { value: 5 }), [o.f, JSON.stringify(Object.getOwnPropertyDescriptor(o, "f"))])` },
  { name: "made-an-accessor", text: `(Object.defineProperty(o, "f", { get() { return 5; } }), [o.f, Object.keys(o).join()])` },
  { name: "hidden", text: `(Object.defineProperty(o, "f", { enumerable: false }), [Object.keys(o).join(), JSON.stringify({ ...o }), typeof o.f])` },
  { name: "frozen", text: "(Object.freeze(o), [Object.isFrozen(o), typeof o.f, Object.keys(o).join()])" },
  { name: "frozen-and-deleted", text: "(() => { Object.freeze(o); try { delete o.f; } catch (e) { return [e.name, typeof o.f]; } return typeof o.f; })()" },
  { name: "sealed-and-given-a-number", text: "(Object.seal(o), o.f = 5, [o.f, o.v])" },
  { name: "listed", text: "[Object.keys(o).join(), Reflect.ownKeys(o).join()]" },
  { name: "walked", text: "(() => { const seen = []; for (const k in o) seen.push(k + typeof o[k]); return seen; })()" },
  { name: "entries", text: "Object.entries(o).map(([k, v]) => k + typeof v).join()" },
  { name: "copied", text: "(c => [Object.keys(c).join(), typeof c.f])({ ...o })" },
  { name: "copied-and-deleted", text: "(c => (delete c.f, [c.f, typeof o.f]))({ ...o })" },
  { name: "assigned", text: "(c => [Object.keys(c).join(), typeof c.f])(Object.assign({}, o))" },
  { name: "rest", text: "(({ v, ...rest }) => [Object.keys(rest).join(), typeof rest.f])(o)" },
  { name: "serialized", text: "JSON.stringify(o)" },
  { name: "described", text: `JSON.stringify(Object.getOwnPropertyDescriptor(o, "f"), (k, v) => typeof v === "function" ? "function" : v)` },
  { name: "inspected", text: "Bun.inspect(o)" },
  { name: "asked-for", text: `["f" in o, Object.hasOwn(o, "f"), o.propertyIsEnumerable("f")]` },
  { name: "read-by-key", text: "[typeof o[key], typeof Reflect.get(o, key)]" },
  { name: "inherited-and-deleted", text: "(c => (delete o.f, c.f))(Object.create(o))" },
];

const head = `// What is defined last under a name is the only thing under that name, whatever the object held there before.
const never = process.argv.length > 99;
const key = never ? "x" : "f";
const show = v => JSON.stringify(v, (k, each) => each === undefined ? "undefined" : typeof each === "function" ? "function" : each);
function t(name, f) { let r; try { r = show(f()); } catch (e) { r = "threw " + e.name; } console.log(name, r); }
`;

export const membersDefinedOverAnEarlierValue = (): CaseFile[] =>
  earlier.flatMap(before =>
    runs.map(run => ({
      name: `over-${before.name}-${run.name}.mjs`,
      head,
      cases: values.flatMap(value =>
        members.flatMap(member =>
          events.map(event => {
            const name = `${before.name} ${value.name} ${member.name} ${run.name} ${event.name}`;
            const definition = before.text
              .replace("VALUE", () => value.text)
              .replace("MEMBER", () => member.inLiteral)
              .replace("STATEMENT", () => member.statement);
            return { name, line: `t("${name}", () => { ${definition} ${run.text} return ${event.text}; });` };
          }),
        ),
      ),
    })),
  );

if (import.meta.main) writeCaseFiles(membersDefinedOverAnEarlierValue());

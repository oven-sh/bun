// One test of an object's layout answers for a stretch of code. Each case is one typed function that reads two fields, calls a method and stores a field of its typed parameter, lets other code run, and does the same again.
// The other code alters the object. The second half finds what plain JavaScript finds there. Where the alteration left a value of another type in a typed field, the read may throw a TypeError.
// The table: how the object is made x the alteration x how the other code gets to run. How the function reaches the object rotates.
//
//   bun objects-altered-mid-function.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/stretch-<how made>-<alteration>.ts.
import { writeCaseFiles, type CaseFile } from "./case-files";
import { callOf, driverOf, headOf, holders, keywordOf, mutators, typedAct, typedSetup, type Holder, type Mutator } from "./repeated-reads";

interface Named {
  name: string;
}

/** Defines the type `C` and `o`. */
const made: (Named & { setup: string; isBelowObjectPrototype?: true })[] = [
  { name: "class-fields", setup: "class C { x = 1; y = 2; m() { return 3; } } const o = new C();" },
  { name: "class-constructor", setup: "class C { x: number; y: number; constructor() { this.x = 1; this.y = 2; } m() { return 3; } } const o = new C();" },
  { name: "subclass", setup: "class A { x = 1; m() { return 3; } } class C extends A { y = 2; } const o = new C();" },
  { name: "literal", setup: "type C = { x: number; y: number; m(): number }; const o: C = { x: 1, y: 2, m() { return 3; } };", isBelowObjectPrototype: true },
  { name: "interface-over-a-class", setup: "interface C { x: number; y: number; m(): number } class K { x = 1; y = 2; z = 0; m() { return 3; } } const o: C = new K();" },
];

/** `a` is the object without a type, `k` the text "x" put together while the program runs. */
const alterations: (Named & { text: string; altersThePrototype?: true })[] = [
  { name: "delete", text: "delete a.x;" },
  { name: "delete-computed", text: "delete a[k];" },
  { name: "delete-reflect", text: "Reflect.deleteProperty(a, 'x');" },
  { name: "delete-and-add-again", text: "delete a.x; a.x = 8;" },
  { name: "define-getter", text: "Object.defineProperty(a, 'x', { get() { return 7; }, configurable: true, enumerable: true });" },
  { name: "define-getter-legacy", text: "a.__defineGetter__('x', function () { return 7; });" },
  { name: "define-setter", text: "Object.defineProperty(a, 'y', { set(v) { a.seen = v; }, get() { return 6; }, configurable: true });" },
  { name: "define-read-only", text: "Object.defineProperty(a, 'y', { writable: false });" },
  { name: "define-hidden", text: "Object.defineProperty(a, 'x', { enumerable: false });" },
  { name: "define-value", text: "Object.defineProperty(a, 'x', { value: 5 });" },
  { name: "define-two", text: "Object.defineProperties(a, { fresh: { value: 1, enumerable: true }, x: { get() { return 7; }, configurable: true } });" },
  { name: "prototype", text: "Object.setPrototypeOf(a, { m() { return -1; } });" },
  { name: "prototype-null", text: "Object.setPrototypeOf(a, null);" },
  { name: "prototype-store", text: "a.__proto__ = { m() { return -1; } };" },
  { name: "prototype-reflect", text: "Reflect.setPrototypeOf(a, { m() { return -1; } });" },
  { name: "prototype-proxy", text: "Object.setPrototypeOf(a, new Proxy({}, { get(t, key) { return key === 'm' ? () => -2 : undefined; } }));" },
  { name: "method-on-the-object", text: "a.m = () => -1;" },
  { name: "method-on-the-prototype", text: "Object.getPrototypeOf(a).m = () => -3;", altersThePrototype: true },
  { name: "method-deleted-above", text: "delete Object.getPrototypeOf(a).m;", altersThePrototype: true },
  { name: "method-hidden-by-a-text", text: "a.m = 'text';" },
  { name: "method-hidden-by-a-text-assigned", text: "Object.assign(a, { m: 'text' });" },
  { name: "method-hidden-by-a-number-defined", text: "Object.defineProperty(a, 'm', { value: 5, configurable: true });" },
  { name: "method-hidden-by-an-accessor", text: "Object.defineProperty(a, 'm', { get() { return () => -4; }, configurable: true });" },
  { name: "freeze", text: "Object.freeze(a);" },
  { name: "seal", text: "Object.seal(a);" },
  { name: "prevent-extensions", text: "Object.preventExtensions(a);" },
  { name: "add", text: "a.extra = 1;" },
  { name: "add-computed", text: "a[k + 'tra'] = 1;" },
  { name: "add-many", text: "for (let i = 0; i < 40; i++) a['n' + i] = i;" },
  { name: "add-element", text: "a[0] = 1;" },
  { name: "element-accessor", text: "Object.defineProperty(a, 0, { get() { return 1; } });" },
  { name: "store-text", text: "a.x = 'text';" },
  { name: "store-null", text: "a.x = null;" },
  { name: "store-undefined", text: "a.x = undefined;" },
  { name: "store-fraction", text: "a.x = 0.5;" },
  { name: "store-object", text: "a.x = { valueOf() { return 4; } };" },
  { name: "store-text-assign", text: "Object.assign(a, { x: 'text' });" },
  { name: "store-text-reflect", text: "Reflect.set(a, 'x', 'text');" },
];

const half = (object: string) =>
  `part.push(String(${object}.x), String(${object}.y)); try { part.push(String(${object}.m())); } catch (e) { part.push((e as Error).name); } try { ${object}.y = ${object}.y + 1; part.push(String(${object}.y)); } catch (e) { part.push((e as Error).name); }`;

function caseOf(how: (typeof made)[number], alteration: (typeof alterations)[number], mutator: Mutator, holder: Holder) {
  const parts = [
    "let change: () => void = () => {};",
    typedSetup(mutator.setup),
    `${how.setup} let done = false; change = () => { if (done) return; done = true; const a = o as any; ${alteration.text} };`,
    holder.setup,
    `${keywordOf[mutator.reader]} read(${holder.typedParameters.replaceAll("T", "C")}) { const part: string[] = []; ${half(holder.object)} ${typedAct(mutator.act)} ${half(holder.object)} return part; }`,
    driverOf(mutator.reader, callOf(holder), value => `const r = ${value};`),
    "return [r, Object.keys(o).join(), Object.isFrozen(o)];",
  ];
  const name = `${how.name} ${alteration.name} ${mutator.name} ${holder.name}`;
  return { name, line: `await t("${name}", async () => { ${parts.filter(part => part).join(" ")} });` };
}

export function caseFiles(): CaseFile[] {
  const usable = holders.filter(holder => !holder.isMadeByTheReader);
  return made.flatMap((how, i) =>
    alterations.flatMap((alteration, j) => {
      // Object.prototype is read-only in an executable.
      if (how.isBelowObjectPrototype && alteration.altersThePrototype) return [];
      return {
        name: `stretch-${how.name}-${alteration.name}.ts`,
        head: headOf("One function reads, calls and stores through a typed parameter, other code alters the object on the way, and the function goes on: it finds what is there at that moment.", true, `const k: string = ["x"].join("");\n`),
        cases: mutators.map((mutator, l) => caseOf(how, alteration, mutator, usable[(i + j + l) % usable.length])),
      };
    }),
  );
}

if (import.meta.main) writeCaseFiles(caseFiles());

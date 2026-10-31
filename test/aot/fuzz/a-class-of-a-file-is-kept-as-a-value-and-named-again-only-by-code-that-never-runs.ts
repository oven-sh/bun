// A table, no seeds: a file declares a class at its top level and its own body puts the class object into something: a list, a Map, a literal, an argument of a call. The only other naming of the class stands in code that never runs.
// The entry point takes the class out by value and uses it in a way that no direct call names.
//
//   how the class is written x what keeps it x who else names it x what the entry point does with it x how the parts lie in files
//
// One case to a program.
type Named = { name: string; text: string };

/** Each declares `Held` with `describe()`, a static `label()` and a constructor that takes a number. What `declares` stands in front. */
const classes: readonly Named[] = [
  { name: "a plain class", text: 'class Held { constructor(a) { this.a = a; } describe() { return "held " + this.a; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "fields", text: 'class Held { a = 0; b = 2; constructor(a) { this.a = a; } describe() { return "held " + this.a + this.b; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "a static field", text: 'class Held { static kind = "kind"; constructor(a) { this.a = a; } describe() { return "held " + this.a; } static label() { return Held.kind; } }' }, // prettier-ignore
  { name: "a static field read through this", text: 'class Held { static kind = "kind"; constructor(a) { this.a = a; } describe() { return "held " + this.a; } static label() { return this.kind; } }' }, // prettier-ignore
  { name: "a static block", text: 'class Held { static kind; static { this.kind = "block"; } constructor(a) { this.a = a; } describe() { return "held " + this.a; } static label() { return this.kind; } }' }, // prettier-ignore
  { name: "a getter", text: 'class Held { constructor(a) { this.a = a; } get twice() { return this.a * 2; } describe() { return "held " + this.twice; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "a private field", text: 'class Held { #a; constructor(a) { this.#a = a; } describe() { return "held " + this.#a; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "a private static method", text: 'class Held { static #hidden() { return "hidden"; } constructor(a) { this.a = a; } describe() { return "held " + this.a; } static label() { return Held.#hidden(); } }' }, // prettier-ignore
  { name: "below a class of the file", text: 'class Base { constructor(a) { this.a = a; } describe() { return "base " + this.a; } static label() { return "base label"; } }\nclass Held extends Base { describe() { return "held " + super.describe(); } }' }, // prettier-ignore
  { name: "below Object", text: 'class Held extends Object { constructor(a) { super(); this.a = a; } describe() { return "held " + this.a; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "below Array", text: 'class Held extends Array { constructor(a) { super(); this.a = a; } describe() { return "held " + this.a + this.length; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "below null's stand-in", text: 'function Above(a) { this.a = a; }\nclass Held extends Above { describe() { return "held " + this.a; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "a method under a computed key", text: 'const key = ["des", "cribe"].join("");\nclass Held { constructor(a) { this.a = a; } [key]() { return "held " + this.a; } static label() { return "label"; } }' }, // prettier-ignore
  { name: "a constructor that asks new.target", text: 'class Held { constructor(a) { this.a = a + (new.target === Held ? 0 : 100); } describe() { return "held " + this.a; } static label() { return "label"; } }' }, // prettier-ignore
];

/** `keeps` is a statement of the file's own body that declares `kept`; `takes` gets the class out of `kept`. Where `registers`, a function of another file keeps it. */
const containers: readonly { name: string; keeps: string; takes: string; registers?: true }[] = [
  { name: "a list", keeps: "export const kept = [Held];", takes: "kept[0]" },
  { name: "a list beside other things", keeps: "export const kept = [1, Held, {}];", takes: "kept[1]" },
  { name: "a Map", keeps: 'export const kept = new Map([["held", Held]]);', takes: 'kept.get("held")' },
  { name: "a Set", keeps: "export const kept = new Set([Held]);", takes: "[...kept][0]" },
  { name: "a literal", keeps: "export const kept = { held: Held };", takes: "kept.held" },
  { name: "a literal in short form", keeps: "export const kept = { Held };", takes: 'kept[["He", "ld"].join("")]' },
  {
    name: "a literal inside a literal",
    keeps: "export const kept = { inner: { held: Held } };",
    takes: "kept.inner.held",
  },
  { name: "another variable", keeps: "export const kept = Held;", takes: "kept" },
  { name: "an argument of a call in the file", keeps: "function boxed(x) { return { x }; }\nexport const kept = boxed(Held);", takes: "kept.x" }, // prettier-ignore
  { name: "an argument of a call of another file", keeps: "register(Held);", takes: "kept[0]", registers: true },
  { name: "a frozen list", keeps: "export const kept = Object.freeze([Held]);", takes: "kept[0]" },
  { name: "a spread list", keeps: "export const kept = [...[Held]];", takes: "kept[0]" },
];

/** Code that never runs. */
const readers: readonly Named[] = [
  { name: "nobody", text: "" },
  { name: "an exported function", text: "export function neverCalled() { return Held; }" },
  { name: "an exported function that makes one", text: "export function neverCalled() { return new Held(5); }" },
  { name: "an exported arrow", text: "export const neverCalled = () => Held;" },
  { name: "a method of an exported class", text: "export class NeverMade { take() { return Held; } }" },
  { name: "a field of an exported class", text: "export class NeverMade { taken = Held; }" },
  {
    name: "a class below it that is never made",
    text: "export function neverCalled() { return class extends Held {}; }",
  },
  { name: "a getter of an exported object", text: "export const neverRead = { get taken() { return Held; } };" },
  { name: "a function of the file alone", text: "function neverCalled() { return Held; }" },
  { name: "instanceof in a function", text: "export function neverCalled(x) { return x instanceof Held; }" },
  { name: "a branch that is never taken", text: "if (process.argv.length > 99) console.log(Held);" },
];

/** `K` is the class that came out. */
const uses: readonly Named[] = [
  { name: "it is constructed", text: "new K(1).describe()" },
  { name: "a static is called", text: "K.label()" },
  { name: "its name", text: "K.name + K.length" },
  { name: "instanceof", text: "String(new K(1) instanceof K) + String({} instanceof K)" },
  { name: "a class below it", text: "new (class Lower extends K {})(2).describe()" },
  { name: "a class below it calls the static", text: "(class Lower extends K {}).label()" },
  { name: "Reflect.construct", text: "Reflect.construct(K, [3]).describe()" },
  {
    name: "Reflect.construct with another new.target",
    text: "Object.getPrototypeOf(Reflect.construct(K, [3], Object)) === Object.prototype",
  },
  { name: "a method out of its prototype", text: "K.prototype.describe.call(new K(4))" },
  { name: "the names of its prototype", text: "Object.getOwnPropertyNames(K.prototype).join()" },
  { name: "its own names", text: "Object.getOwnPropertyNames(K).sort().join()" },
  {
    name: "called without new",
    text: "(() => { try { return K(1); } catch (error) { return error.constructor.name; } })()",
  },
];

const layouts = ["one file", "two files", "three files"] as const;

const crossed = classes.flatMap(written =>
  containers.flatMap(keeps =>
    readers.flatMap(reads =>
      uses.flatMap(use =>
        layouts
          .filter(layout => (layout === "three files") === Boolean(keeps.registers))
          .map(layout => ({ written, keeps, reads, use, layout })),
      ),
    ),
  ),
);

// Every third case of the table: its neighbors differ in the layout and in what the entry point does.
const taken = crossed.filter((_, at) => at % 3 === 0);
export const programs = taken.length;

const withoutExports = (text: string) => text.replace(/^export /gm, "");

export function programOf(index: number): { file: string; text: string; files?: Record<string, string> } {
  // A stride that shares no factor with the length of the table takes a run's share from all over it.
  const { written, keeps, reads, use, layout } = taken[(index * 7919) % taken.length];
  const label = `${written.name} | ${keeps.name} | ${reads.name} | ${use.name} | ${layout}`;
  const entry = `const K = ${keeps.takes};\nconsole.log(${JSON.stringify(label)} + ": " + String(${use.text}));\n`;
  const holder = `${written.text}\n${keeps.keeps}\n${reads.text}\n`;
  switch (layout) {
    case "one file":
      return { file: "main.js", text: withoutExports(holder) + entry };
    case "two files":
      return { file: "main.js", text: `import { kept } from "./held.js";\n${entry}`, files: { "held.js": holder } };
    case "three files":
      return {
        file: "main.js",
        text: `import "./held.js";\nimport { kept } from "./registry.js";\n${entry}`,
        files: {
          "registry.js": "export const kept = [];\nexport function register(x) { kept.push(x); }\n",
          "held.js": `import { register } from "./registry.js";\n${holder}`,
        },
      };
  }
}

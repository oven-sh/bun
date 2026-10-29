// The entry point takes types alone from another file of the program, so that file never runs and an executable holds no code of it: what stands there is only read for what it declares.
// Every way to take a type from a file x every place where a type stands x everything that such a file holds, all of it checked, with the entry point under `// @ts-nocheck`, and with the other file under it:
// each once, twenty to a program, each with files of its own. Every file of types begins by printing a line: a program in which it ran after all shows that.

/** `@@` is the number of the case in its program. The file `types@@.ts` exports the type `T`; `value` is something to carry through the entry point under that type. */
const held: readonly { name: string; files: Record<string, string>; value: string }[] = [
  { name: "an enum whose members name members by a path", files: { "types@@.ts": "export enum T { Read = 1, Write = 2, All = T.Read | T.Write }" }, value: "3" },
  { name: "an enum whose members name members in brackets", files: { "types@@.ts": 'export enum T { Read = 1, Write = 2, "not a name" = 4, Both = T["Read"] | T[`Write`], All = T.Both | T["not a name"] }' }, value: "7" },
  { name: "an enum whose members name members alone", files: { "types@@.ts": "export enum T { Read = 1, Write = 2, All = Read | Write }" }, value: "3" },
  { name: "an enum made of another enum of the file", files: { "types@@.ts": "enum Near { One = 1 }\nexport enum T { First = Near.One, Next = Near.One + 1 }" }, value: "2" },
  { name: "an enum made of an enum in a namespace", files: { "types@@.ts": "namespace Inner { export enum Deep { Two = 2, Four = Deep.Two << 1 } }\nexport enum T { Second = Inner.Deep.Two | Inner.Deep.Four }" }, value: "6" },
  { name: "an enum of texts made by a template", files: { "types@@.ts": 'export enum T { Low = "low", High = "high", Both = `${T.Low}-${T.High}` }' }, value: '"low-high"' },
  { name: "a const enum", files: { "types@@.ts": "export const enum T { A = 1, B = A << 2, C = T.B | T.A }" }, value: "5" },
  { name: "an enum declared twice", files: { "types@@.ts": "export enum T { A = 1 }\nexport enum T { B = T.A + 1 }" }, value: "2" },
  { name: "an enum with a computed member", files: { "types@@.ts": 'export enum T { A = "abc".length, B = A * 2, C = T.B + 1 }' }, value: "7" },
  { name: "an enum made of a constant", files: { "types@@.ts": "const base = 2;\nexport enum T { A = base, B = base * 2, C = T.A | T.B }" }, value: "6" },
  { name: "an enum made of an enum of a third file", files: { "types@@.ts": 'import { Far } from "./far@@";\nexport enum T { Third = Far.Eight | Far.Sixteen, More = T.Third + 1 }', "far@@.ts": 'console.log("the third file ran: @@");\nexport enum Far { Eight = 8, Sixteen = Far.Eight * 2 }' }, value: "24" },
  { name: "an enum with signs ahead of paths", files: { "types@@.ts": "export enum T { A = -1, B = ~T.A, C = +T.B, D = -T.C, E = (T.A) }" }, value: "-1" },
  { name: "an enum that counts on behind a path", files: { "types@@.ts": "export enum T { A = 1, B = T.A + 5, C }" }, value: "7" },
  { name: "a declared constant with a member for its value", files: { "types@@.ts": "export enum E { A = 1, B = E.A << 3 }\nexport declare const K = E.B;\nexport type T = typeof K;" }, value: "8" },
  { name: "a declared enum", files: { "types@@.ts": "export declare enum T { A = 1, B = T.A | 2 }" }, value: "3" },
  { name: "the names of an enum", files: { "types@@.ts": "export enum E { A = 1, B = E.A + 1 }\nexport type T = keyof typeof E;" }, value: '"A"' },

  { name: "a class with private names and accessors", files: { "types@@.ts": "export class T { #p = 1; get p() { return this.#p; } set p(v: number) { this.#p = v; } static #s = 2; static { T.#s++; } static s() { return T.#s; } }" }, value: "{ p: 1 }" },
  { name: "a class with parameter properties", files: { "types@@.ts": "export class T { constructor(public a: number, private b = 2, readonly c?: string) {} sum() { return this.a + this.b; } }" }, value: "{ a: 1 }" },
  { name: "an abstract class and its heir", files: { "types@@.ts": "export abstract class Base { abstract area(): number; twice() { return this.area() * 2; } }\nexport class T extends Base { area() { return 2; } }" }, value: "{}" },
  { name: "a generic class with a static field", files: { "types@@.ts": "export class T<X = number> { static made = 0; items: X[] = []; add(x: X) { T.made++; this.items.push(x); return this; } }" }, value: "{ items: [] }" },
  { name: "a class expression in a constant", files: { "types@@.ts": "export const Made = class { v = 1; };\nexport type T = InstanceType<typeof Made>;" }, value: "{ v: 1 }" },
  { name: "a class below a class that a function returns", files: { "types@@.ts": "const make = () => class { static #c = 1; static t: number; static { this.t = this.#c; } };\nexport class T extends make() {}" }, value: "{}" },
  { name: "a class with auto-accessors", files: { "types@@.ts": "export class T { accessor x = 1; static accessor y = 2; }" }, value: "{ x: 1 }" },
  { name: "a class with a decorated method", files: { "types@@.ts": "function mark(value: unknown, context: unknown) {}\nexport class T { @mark m() { return 1; } }" }, value: "{}" },

  { name: "a constructor function", files: { "types@@.ts": "export function Make(this: { a: number }) { this.a = 1; }\nMake.prototype.twice = function () { return 2; };\nexport type T = typeof Make;" }, value: "0" },
  { name: "the type of a table", files: { "types@@.ts": 'const table = { a: 1, b: "x" };\nexport type T = typeof table;' }, value: '{ a: 1, b: "x" }' },
  { name: "an element of a constant list", files: { "types@@.ts": 'const list = ["a", "b"] as const;\nexport type T = (typeof list)[number];' }, value: '"a"' },
  { name: "what a function returns", files: { "types@@.ts": "function make() { return { v: [1, 2] }; }\nexport type T = ReturnType<typeof make>;" }, value: "{ v: [1, 2] }" },
  { name: "a parameter of an overloaded function", files: { "types@@.ts": "export function f(x: number): number;\nexport function f(x: string): string;\nexport function f(x: unknown) { return x; }\nexport type T = Parameters<typeof f>[0];" }, value: '"s"' },
  { name: "what an async generator returns", files: { "types@@.ts": "async function* g() { yield 1; }\nexport type T = ReturnType<typeof g>;" }, value: "{}" },

  { name: "an enum in a namespace beside a constant", files: { "types@@.ts": "export namespace N { export const v = 1; export type Inner = number; export enum E { A = 1, B = E.A + N.v } }\nexport type T = N.E;" }, value: "2" },
  { name: "an alias of an enum in nested namespaces", files: { "types@@.ts": "namespace A.B { export enum E { X = 1, Y = E.X << 1 } }\nimport Short = A.B.E;\nexport type T = Short;" }, value: "2" },
  { name: "a member added to a global interface", files: { "types@@.ts": 'declare global { interface Array<T> { extra@@?: number } }\nexport type T = number[]["extra@@"];' }, value: "undefined" },

  { name: "an interface", files: { "types@@.ts": "export interface T { a: number; b?: string }" }, value: "{ a: 1 }" },
  { name: "a conditional type", files: { "types@@.ts": "export type T = string extends infer X ? X[] : never;" }, value: '["x"]' },
  { name: "a mapped type over template texts", files: { "types@@.ts": 'export type T = { [K in `on${Capitalize<"a" | "b">}`]: number };' }, value: "{ onA: 1, onB: 2 }" },
  { name: "an interface that holds an enum of the file", files: { "types@@.ts": "enum Kind { A = 1, B = Kind.A | 2 }\nexport interface T { kind: Kind }" }, value: "{ kind: 3 }" },
  { name: "a type that names itself", files: { "types@@.ts": "export type T = { next?: T; v: number };" }, value: "{ v: 1, next: { v: 2 } }" },

  { name: "a file that throws at its top", files: { "types@@.ts": 'export type T = number;\nthrow new Error("never");' }, value: "1" },
  { name: "a file that awaits at its top", files: { "types@@.ts": 'export type T = number;\nawait Promise.resolve();\nconsole.log("behind the await: @@");' }, value: "1" },
  { name: "a file that changes a global object", files: { "types@@.ts": "export type T = number;\n(globalThis as { changed@@?: number }).changed@@ = 1;" }, value: "(globalThis as { changed@@?: number }).changed@@" },

  { name: "a declaration file with an enum beside JavaScript", files: { "types@@.d.ts": "export declare enum T { A = 1, B = T.A | 2 }", "types@@.js": "export const T = { A: 1, B: 3 };" }, value: "3" },
  { name: "a declaration file with a class beside JavaScript", files: { "types@@.d.ts": "export declare class T { #p; get p(): number; static s(): number; }", "types@@.js": "export class T { #p = 1; get p() { return this.#p; } static s() { return 2; } }" }, value: "{ p: 1 }" },
  { name: "a declaration file with a constant of an enum beside JavaScript", files: { "types@@.d.ts": "export declare enum E { Step = 4, Most = E.Step << 2 }\nexport declare const most = E.Most;\nexport type T = typeof most;", "types@@.js": "export const most = 16;" }, value: "16" },
  { name: "a declaration file with a namespace beside JavaScript", files: { "types@@.d.ts": "export declare namespace N { enum E { A = 1, B = E.A | 4 } }\nexport type T = N.E;", "types@@.js": "export const N = { E: { A: 1, B: 5 } };" }, value: "5" },
]; // prettier-ignore

/** `head` stands at the top of the entry point, `type` is how the type is written there, `files` are files between the two. */
const ways: readonly { name: string; head?: string; type: string; files?: Record<string, string> }[] = [
  { name: "a plain import", head: 'import { T as T@@ } from "./types@@";', type: "T@@" },
  { name: "import type", head: 'import type { T as T@@ } from "./types@@";', type: "T@@" },
  { name: "type inside the braces", head: 'import { type T as T@@ } from "./types@@";', type: "T@@" },
  { name: "import type of everything", head: 'import type * as all@@ from "./types@@";', type: "all@@.T" },
  { name: "an import of everything", head: 'import * as all@@ from "./types@@";', type: "all@@.T" },
  { name: "import() in the type", type: 'import("./types@@").T' },
  { name: "through a file that exports the type", head: 'import { T as T@@ } from "./between@@";', type: "T@@", files: { "between@@.ts": 'console.log("the file between ran: @@");\nexport type { T } from "./types@@";' } },
  { name: "through a file that exports everything", head: 'import type { T as T@@ } from "./between@@";', type: "T@@", files: { "between@@.ts": 'console.log("the file between ran: @@");\nexport * from "./types@@";' } },
  { name: "inside an interface of a file between", head: 'import { Holder as Holder@@ } from "./between@@";', type: 'Holder@@["t"]', files: { "between@@.ts": 'console.log("the file between ran: @@");\nimport { T } from "./types@@";\nexport interface Holder { t: T }' } },
]; // prettier-ignore

/** `N` is the type and `V` the value under that type. `sees` is what is printed. */
const places: readonly { name: string; text?: string; sees: string }[] = [
  { name: "of a constant", text: "const x: N = V;", sees: "x" },
  { name: "of a parameter", text: "function f(x: N) { return x; }", sees: "f(V)" },
  { name: "of what a function returns", text: "function f(): N { return V; }", sees: "f()" },
  { name: "as an argument of a generic class", text: 'const m = new Map<string, N>();\n  m.set("k", V);', sees: 'm.get("k")' },
  { name: "of the elements of a list", text: "const l: N[] = [V];", sees: "l[0]" },
  { name: "in a cast alone", sees: "V" },
  { name: "in an interface", text: "interface Mine { t: N }\n  const o: Mine = { t: V };", sees: "o.t" },
  { name: "of a field of a class", text: "class C { t: N = V; }", sees: "new C().t" },
  { name: "in a predicate", text: "function is(x: unknown): x is N { return true; }\n  const v: unknown = V;", sees: "is(v) ? v : 0" },
  { name: "under keyof", text: 'type K = keyof N;\n  const k = "k" as unknown as K;', sees: "String(k)" },
  { name: "as the bound of a type parameter", text: "function same<X extends N>(x: X) { return x; }", sees: "same(V)" },
  { name: "behind satisfies", sees: "V satisfies N" },
  { name: "in a union", text: "let x: N | undefined;\n  x = V;", sees: "x" },
  { name: "of a rest parameter", text: "function f(...all: N[]) { return all[0]; }", sees: "f(V)" },
]; // prettier-ignore

const kinds = ["all checked", "the entry point is not checked", "the file of types is not checked"] as const;

export const inOne = 20;
const cases = ways.length * places.length * held.length;
const inOneKind = Math.ceil(cases / inOne);
export const programs = inOneKind * kinds.length;

export function programOf(index: number): { file: string; text: string; files: Record<string, string> } {
  const kind = kinds[Math.floor(index / inOneKind)];
  const first = (index % inOneKind) * inOne;
  const heads: string[] = [];
  const files: Record<string, string> = {};
  const blocks = Array.from({ length: Math.min(cases, first + inOne) - first }, (_, at) => {
    // What the file holds moves fastest, so that a program holds many different files.
    const number = first + at;
    const holds = held[number % held.length];
    const place = places[Math.floor(number / held.length) % places.length];
    const way = ways[Math.floor(number / (held.length * places.length))];
    const numbered = (text: string) => text.replaceAll("@@", String(at));
    if (way.head) heads.push(numbered(way.head));
    for (const [name, text] of Object.entries({ ...holds.files, ...way.files })) {
      const runs = !name.endsWith(".d.ts") && name.startsWith("types");
      files[numbered(name)] =
        (kind === kinds[2] && name === "types@@.ts" ? "// @ts-nocheck\n" : "") +
        (runs ? `console.log("the file of types ran: ${at}");\n` : "") +
        numbered(text) +
        "\n";
    }
    const typed = (text: string) =>
      numbered(text.replace(/\bN\b/g, way.type).replace(/\bV\b/g, `(${holds.value} as unknown as ${way.type})`));
    return `{${place.text ? `\n  ${typed(place.text)}` : ""}
  console.log(${JSON.stringify(`${way.name} | ${place.name} | ${holds.name}`)} + ": " + show(${typed(place.sees)}));
}`;
  });
  return {
    file: "main.ts",
    text: `${kind === kinds[1] ? "// @ts-nocheck\n" : ""}${heads.join("\n")}
const show = (value: unknown) => typeof value + " " + JSON.stringify(value);
${blocks.join("\n")}
export {};
`,
    files,
  };
}

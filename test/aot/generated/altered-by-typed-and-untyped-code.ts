// What altering a typed object does depends on the object and on the alteration, never on who alters it. Each program makes a typed object, has it altered once, and prints what the alteration gave or threw,
// the state of the object afterwards, what a typed read and a typed store say afterwards, and the same of a second object that nobody altered.
// The table: how the object is made x the alteration and how it is spelled x who does it: typed code, an untyped file, a package, text that is evaluated.
//
//   bun altered-by-typed-and-untyped-code.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//   bun altered-by-typed-and-untyped-code.ts --compare <answers.tsv> [<answers.tsv of another run> ..]
//
// The first writes <folder>/<how made>.<alteration>.<who>/main.ts and the files beside it. The second reads what ../generated-table-altered-by-typed-and-untyped-code.test.ts leaves in AOT_GENERATED_KEEP.
// Of one run it prints, for every alteration, the classes that the answers of the executables fall into, and who is in each. Of several runs it prints the programs that do not answer the same in all of them.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { spread } from "./case-files";

const classP = `class P { x: number = 1; y: string = "s"; m(): number { return this.x; } }`;

/** Each defines `make`. */
const made: { name: string; lines: string[] }[] = [
  { name: "class-fields", lines: [classP, "const make = (): T => new P();"] },
  { name: "class-constructor", lines: [`class P { x: number; y: string; constructor() { this.x = 1; this.y = "s"; } m(): number { return this.x; } }`, "const make = (): T => new P();"] },
  { name: "subclass", lines: [classP, "class Q extends P { z: number = 3; }", "const make = (): T => new Q();"] },
  { name: "mixin", lines: [classP, "const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };", "const M = Mix(P);", "const make = (): T => new M();"] },
  { name: "class-expression", lines: [`const make = (): T => new (class { x: number = 1; y: string = "s"; m(): number { return this.x; } })();`] },
  { name: "generic-class", lines: [`class G<V> { x: number = 1; y: string = "s"; v: V; constructor(v: V) { this.v = v; } m(): number { return this.x; } }`, "const make = (): T => new G<boolean>(true);"] },
  { name: "constructor-function", lines: [`function F(this: T) { this.x = 1; this.y = "s"; }`, "F.prototype.m = function (this: T): number { return this.x; };", "const make = (): T => new (F as unknown as new () => T)();"] },
  { name: "literal-annotated", lines: [`const make = (): T => { const o: T = { x: 1, y: "s", m() { return this.x; } }; return o; };`] },
  { name: "literal-plain", lines: [`const make = () => ({ x: 1, y: "s", m(): number { return this.x; } });`] },
  { name: "cast-of-parsed", lines: [`const make = (): T => Object.assign(JSON.parse('{"x":1,"y":"s"}'), { m(this: T) { return this.x; } }) as T;`] },
  { name: "object-create", lines: ["const proto = { m(this: T): number { return this.x; } };", `const make = (): T => Object.assign(Object.create(proto), { x: 1, y: "s" }) as T;`] },
  { name: "spread-copy", lines: [classP, "const make = (): T => ({ ...new P(), m() { return this.x; } });"] },
  { name: "package-class", lines: [`import { P } from "pkg";`, "const make = (): T => new P();"] },
];

interface Spelling {
  /** The type of `o` where typed code does it. */
  parameter: string;
  /** `o` is the object, `k` the text "x" put together while the program runs. */
  body: string;
}

interface Operation extends Spelling {
  name: string;
  /** How typed code has to spell it, where the checker rejects the plain text. */
  typed?: Spelling;
}

const operations: Operation[] = [
  { name: "delete", parameter: "{ x?: number }", body: "return delete o.x;" },
  { name: "delete-computed", parameter: "Record<string, unknown>", body: "return delete o[k];", typed: { parameter: "object", body: "return delete (o as Record<string, unknown>)[k];" } },
  { name: "delete-reflect", parameter: "object", body: "return Reflect.deleteProperty(o, 'x');" },
  { name: "define-getter", parameter: "object", body: "Object.defineProperty(o, 'x', { get() { return 7; }, configurable: true, enumerable: true }); return 'defined';" },
  { name: "define-getter-computed", parameter: "object", body: "Object.defineProperty(o, k, { get() { return 7; }, configurable: true, enumerable: true }); return 'defined';" },
  { name: "define-getter-reflect", parameter: "object", body: "return Reflect.defineProperty(o, 'x', { get() { return 7; }, configurable: true, enumerable: true });" },
  { name: "define-getter-legacy", parameter: "any", body: "o.__defineGetter__('x', function () { return 7; }); return 'defined';" },
  { name: "define-read-only", parameter: "object", body: "Object.defineProperty(o, 'x', { writable: false }); return 'defined';" },
  { name: "define-hidden", parameter: "object", body: "Object.defineProperty(o, 'x', { enumerable: false }); return 'defined';" },
  { name: "define-locked", parameter: "object", body: "Object.defineProperty(o, 'x', { configurable: false }); return 'defined';" },
  { name: "define-value", parameter: "object", body: "Object.defineProperty(o, 'x', { value: 5 }); return 'defined';" },
  { name: "define-same", parameter: "object", body: "Object.defineProperty(o, 'x', { value: 1, writable: true, enumerable: true, configurable: true }); return 'defined';" },
  { name: "define-two", parameter: "object", body: "Object.defineProperties(o, { fresh: { value: 1, enumerable: true }, x: { get() { return 7; }, configurable: true } }); return 'defined';" },
  { name: "prototype", parameter: "object", body: "Object.setPrototypeOf(o, { m() { return -1; } }); return 'set';" },
  { name: "prototype-same", parameter: "object", body: "Object.setPrototypeOf(o, Object.getPrototypeOf(o)); return 'set';" },
  { name: "prototype-null", parameter: "object", body: "Object.setPrototypeOf(o, null); return 'set';" },
  { name: "prototype-store", parameter: "any", body: "o.__proto__ = { m() { return -1; } }; return 'set';" },
  { name: "prototype-reflect", parameter: "object", body: "return Reflect.setPrototypeOf(o, { m() { return -1; } });" },
  { name: "freeze", parameter: "object", body: "Object.freeze(o); return 'frozen';" },
  { name: "seal", parameter: "object", body: "Object.seal(o); return 'sealed';" },
  { name: "prevent-extensions", parameter: "object", body: "Object.preventExtensions(o); return 'closed';" },
  { name: "prevent-extensions-reflect", parameter: "object", body: "return Reflect.preventExtensions(o);" },
  { name: "add", parameter: "{ extra?: number }", body: "o.extra = 1; return o.extra;", typed: { parameter: "{ x: number; extra?: number }", body: "o.extra = 1; return o.extra;" } },
  {
    name: "add-computed",
    parameter: "Record<string, unknown>",
    body: "o[k + 'tra'] = 1; return o[k + 'tra'];",
    typed: { parameter: "object", body: "(o as Record<string, unknown>)[k + 'tra'] = 1; return (o as Record<string, unknown>)[k + 'tra'];" },
  },
  { name: "store-text", parameter: "{ x: number | string }", body: "o.x = 'text'; return o.x;" },
  { name: "store-null", parameter: "{ x: number | null }", body: "o.x = null; return o.x;" },
  { name: "store-undefined", parameter: "{ x?: number }", body: "o.x = undefined; return o.x;" },
  { name: "store-text-computed", parameter: "Record<string, unknown>", body: "o[k] = 'text'; return o[k];", typed: { parameter: "object", body: "(o as Record<string, unknown>)[k] = 'text'; return (o as Record<string, unknown>)[k];" } },
  { name: "store-text-assign", parameter: "object", body: "Object.assign(o, { x: 'text' }); return 'assigned';" },
  { name: "store-text-reflect", parameter: "object", body: "return Reflect.set(o, 'x', 'text');" },
  { name: "replace-method", parameter: "{ m(): number }", body: "o.m = () => -1; return o.m();" },
];

const actors = ["typed", "untyped-file", "package", "text"] as const;

const head = `declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const k: string = ["x"].join(process.argv.length > 99 ? "y" : "");
interface T { x: number; y: string; m(): number }
`;

const tail = `
function read(p: T): string { try { return typeof p.x + " " + String(p.x + 1) + " " + String(p.m()); } catch (e) { return "read threw " + (e as Error).name; } }
function store(p: T): string { try { p.x = 2; return "stored " + String(p.x); } catch (e) { return "store threw " + (e as Error).name; } }
function state(o: object): string {
  const d = Object.getOwnPropertyDescriptor(o, "x");
  const kind = d === undefined ? "none" : (d.get ? "accessor" : "data") + (d.writable ? "W" : "") + (d.enumerable ? "E" : "") + (d.configurable ? "C" : "");
  return [kind, Object.keys(o).join("+"), Object.isExtensible(o) ? "open" : "closed", Object.isFrozen(o) ? "frozen" : Object.isSealed(o) ? "sealed" : "-"].join(" ");
}
const other = make(); read(other);
const o = make();
const before = state(o) + " | " + read(o);
let answer: string;
try { answer = "gave " + String(act(o, k)); } catch (e) { answer = "threw " + (e as Error).name + ": " + String((e as Error).message).slice(0, 70); }
console.log(before); console.log(answer); console.log(state(o) + " | " + read(o) + " | " + store(o)); console.log("another object: " + state(other) + " | " + read(other) + " | " + store(other));
`;

export interface Program {
  /** `<how made> <alteration> <who>` */
  name: string;
  made: string;
  operation: string;
  who: (typeof actors)[number];
  files: Record<string, string>;
}

function filesOf(how: (typeof made)[number], operation: Operation, who: Program["who"]) {
  const files: Record<string, string> = {};
  const untyped = `export function act(o, k) { ${operation.body} }\n`;
  const declared = "export function act(o: unknown, k: string): unknown;\n";
  const typed = operation.typed ?? operation;
  const inPackage = { code: "", types: "" };
  const actor = {
    "typed": `function act(o: ${typed.parameter}, k: string): unknown { ${typed.body} }`,
    "untyped-file": `import { act } from "./untyped.js";`,
    "package": `import { act } from "pkg";`,
    "text": `const act = new Function("o", "k", [${JSON.stringify(`"use strict"; ${operation.body}`)}].join(k === "x" ? "" : "y")) as (o: unknown, k: string) => unknown;`,
  }[who];
  if (who === "untyped-file") Object.assign(files, { "untyped.js": untyped, "untyped.d.ts": declared });
  if (who === "package") Object.assign(inPackage, { code: untyped, types: declared });
  if (how.name === "package-class") {
    inPackage.code += `export class P { x = 1; y = "s"; m() { return this.x; } }\n`;
    inPackage.types += "export class P { x: number; y: string; m(): number; }\n";
  }
  if (inPackage.code) {
    files["node_modules/pkg/package.json"] = `{ "name": "pkg", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts" }\n`;
    files["node_modules/pkg/index.js"] = inPackage.code;
    files["node_modules/pkg/index.d.ts"] = inPackage.types;
  }
  const lines = [actor, ...how.lines].map(line => line + "\n");
  const isImport = (line: string) => line.startsWith("import ");
  files["main.ts"] = lines.filter(isImport).join("") + head + lines.filter(line => !isImport(line)).join("") + tail;
  return files;
}

export const programs = (): Program[] =>
  made.flatMap(how => operations.flatMap(operation => actors.map(who => ({ name: `${how.name} ${operation.name} ${who}`, made: how.name, operation: operation.name, who, files: filesOf(how, operation, who) }))));

export interface Answers {
  made: string;
  operation: string;
  who: string;
  /** The lines that were printed, joined by " // ", or how the run or the build failed. */
  plain: string;
  compiled: string;
}

function classOf({ plain, compiled }: Answers) {
  if (plain === compiled) return "as plain";
  if (compiled.startsWith("BUILD")) return "does not build: " + compiled.slice(7, 70);
  const [ours, theirs] = [compiled, plain].map(answers => answers.split(" // ")[1] ?? answers);
  return ours === theirs ? "same answer, another state or use afterwards" : "answers: " + ours.replace(/\s+/g, " ").slice(0, 70);
}

/** For every alteration that some executable does not answer as plain Bun: the classes of the answers. A rule that holds shows as classes that follow how the object is made, never who alters it. */
export function classesOf(rows: Answers[]): string {
  const lines: string[] = [];
  const byOperation = Map.groupBy(rows, row => row.operation);
  for (const [operation, members] of byOperation) {
    const classes = Map.groupBy(members, classOf);
    if (classes.size === 1 && classes.has("as plain")) continue;
    lines.push(`== ${operation}`);
    for (const [name, inClass] of [...classes].sort((a, b) => b[1].length - a[1].length)) {
      const distinct = (values: string[]) => [...new Set(values)].sort().join(" ");
      lines.push(`   ${String(inClass.length).padStart(4)} ${name}`, `        made: ${distinct(inClass.map(row => row.made))}`, `        who: ${distinct(inClass.map(row => row.who))}`);
    }
  }
  const asPlain = [...byOperation.values()].filter(members => members.every(row => classOf(row) === "as plain")).length;
  return [...lines, `${asPlain} operations are as plain Bun for every way of making and every actor`].join("\n");
}

export const toTable = (rows: Answers[]) => rows.map(row => [row.made, row.operation, row.who, row.plain, row.compiled, row.plain === row.compiled ? "same" : "DIFFERS"].join("\t") + "\n").join("");

function fromTable(path: string): Answers[] {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line);
  return rows.map(line => line.split("\t")).map(([made, operation, who, plain, compiled]) => ({ made, operation, who, plain, compiled }));
}

function differencesBetween(paths: string[]): string {
  const runs = paths.map(path => new Map(fromTable(path).map(row => [`${row.made} ${row.operation} ${row.who}`, row.compiled])));
  const differing = [...runs[0].keys()].filter(name => new Set(runs.map(run => run.get(name))).size > 1);
  return [...differing.flatMap(name => [name, ...paths.map((path, i) => `     ${basename(path)}: ${String(runs[i].get(name)).slice(0, 200)}`)]), `${differing.length} programs answer differently between the runs`].join("\n");
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  if (words[0] === "--compare") {
    console.log(words.length === 2 ? classesOf(fromTable(words[1])) : differencesBetween(words.slice(1)));
  } else {
    const option = (name: string) => words.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
    const only = new RegExp(option("only") ?? "");
    const matching = programs().filter(({ name }) => only.test(name));
    const names = matching.map(({ name }) => name);
    const kept = new Set(option("sample") ? spread(names, Number(option("sample"))) : names);
    for (const { name, files } of matching.filter(({ name }) => kept.has(name))) {
      for (const [file, text] of Object.entries(files)) {
        const path = join(words[0], name.replaceAll(" ", "."), file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
    }
    console.log(`${kept.size} programs`);
  }
}

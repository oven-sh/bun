// A plugin of `Bun.build` that answers JavaScript for a TypeScript file, as the plugins of Solid, Vue and Svelte do, with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
// What runs is what the plugin answers. What the importers of the file see as types is the file, as in an editor.
import { isWindows } from "harness";
import { buildBothWays } from "./build-both-ways";

// Every .tsx file becomes JavaScript without its types. `rewrite` changes the JavaScript.
const erases = (rewrite = "text => text") => `const rewrite = ${rewrite};
build.onLoad({ filter: /\\.tsx$/ }, async (args: any) => {
  const text = await Bun.file(args.path).text();
  return { contents: rewrite(new Bun.Transpiler({ loader: "tsx" }).transformSync(text)), loader: "js" };
});`;

buildBothWays("compile/aot/a plugin answers JavaScript for a TypeScript file", {
  "types that only the file on disk has": {
    files: {
      "main.ts": `import { area, type Shape } from "./view";
import type { Side, Sized } from "./view";
const shape: Shape = { width: 2, height: 3 };
const side: Side = "left";
const sized: Sized<string> = { size: 1, of: "one" };
console.log(area(shape), side, JSON.stringify(sized));`,
      "view.tsx": `export type Shape = { width: number; height: number };
export type Side = "left" | "right";
export interface Sized<T> { size: number; of: T }
export function area(shape: Shape): number { return shape.width * shape.height; }`,
    },
    plugins: [erases()],
    prints: `6 left {"size":1,"of":"one"}\n`,
  },
  "a callback whose parameters get their types from such a type": {
    files: {
      "main.ts": `import { subscribe, type Source } from "./view";
const source: Source = { subscribe: handler => handler({ name: "first", count: 1 }), each: (items, visit) => items.map(visit) };
console.log(subscribe(source), source.each([1, 2], item => item * 2).join());`,
      "view.tsx": `export type Event = { name: string; count: number };
export type Source = { subscribe(handler: (event: Event) => string): string; each(items: number[], visit: (item: number) => number): number[] };
export function subscribe(source: Source): string { return source.subscribe(event => event.name + event.count); }`,
    },
    plugins: [erases()],
    prints: "first1 2,4\n",
  },
  "one name that is a value and a type, through a namespace": {
    files: {
      "main.ts": `import * as Config from "./config";
export type Info = Config.Info;
const info: Info = Config.Info.parse("a=1");
const resolved: Config.Resolved = { ...info, done: true };
console.log(JSON.stringify(resolved), Object.keys(Config).sort().join());`,
      "config.tsx": `export type Info = { key: string; value: string };
export type Resolved = Info & { done: boolean };
export const Info = { parse(text: string): Info { const [key, value] = text.split("="); return { key: key!, value: value! }; } };`,
    },
    plugins: [erases()],
    prints: `{"key":"a","value":"1","done":true} Info\n`,
  },
  "a class: made, extended and tested by its importer": {
    files: {
      "main.ts": `import { Box, unwrap } from "./box";
class Labelled extends Box<number> {
  constructor(value: number, public label: string) { super(value); }
  override describe(): string { return this.label + ":" + super.describe(); }
}
const plain = new Box("text");
const labelled = new Labelled(4, "four");
const boxes: Box<unknown>[] = [plain, labelled];
console.log(plain.value, plain.describe(), labelled.describe(), labelled.doubled, unwrap(labelled), boxes.map(box => box instanceof Labelled).join(), Box.made);`,
      "box.tsx": `export class Box<T> {
  static made = 0;
  readonly doubled: string;
  constructor(public value: T) { Box.made++; this.doubled = String(value) + String(value); }
  describe(): string { return "box of " + String(this.value); }
}
export function unwrap<T>(box: Box<T>): T { return box.value; }`,
    },
    plugins: [erases()],
    prints: "text box of text four:box of 4 44 4 false,true 2\n",
  },
  "enums": {
    files: {
      "main.ts": `import { Level, Name, pick } from "./levels";
const level: Level = Level.High;
console.log(level, Level[level], Name.Second, pick(Level.Low), Object.keys(Level).join());`,
      "levels.tsx": `export enum Level { Low, High = 5 }
export enum Name { First = "first", Second = "second" }
export function pick(level: Level): Name { return level === Level.Low ? Name.First : Name.Second; }`,
    },
    plugins: [erases()],
    prints: "5 High second first 0,5,Low,High\n",
  },
  "what runs does not fit what the file declares": {
    files: {
      "main.ts": `import { Level, Point, count, limit, origin } from "./values";
const total: number = count(2);
const point = new Point(1, 2);
console.log(typeof total, total + 1, typeof limit, limit + 1, JSON.stringify(origin), origin.x + 1, Level.High, JSON.stringify(point), point.x + point.y, JSON.stringify(point.sum()));`,
      "values.tsx": `export enum Level { Low, High }
export function count(by: number): number { return by * 2; }
export const limit: number = 10;
export const origin: { x: number; y: number } = { x: 0, y: 0 };
export class Point { constructor(public x: number, public y: number) {} sum(): number { return this.x + this.y; } }`,
    },
    plugins: [
      erases(`() => \`export const Level = { Low: "low", High: "high" };
export function count(by) { return "counted " + by; }
export const limit = "ten";
export const origin = { y: "why", extra: true, x: "ex" };
export class Point { constructor(x, y) { this.y = String(y); this.z = 0; this.x = String(x); } sum() { return [this.x, this.y]; } }\``),
    ],
    prints: `string counted 21 string ten1 {"y":"why","extra":true,"x":"ex"} ex1 high {"y":"2","z":0,"x":"1"} 12 ["1","2"]\n`,
  },
  "what runs is given what the file does not declare": {
    files: {
      "main.ts": `import { describe } from "./describe";
const loose = describe as (value: unknown, times?: unknown) => string;
console.log(describe({ name: "typed" }, 2), loose("text"), loose({ name: 5 }, "x"), loose(null));`,
      "describe.tsx": `export function describe(value: { name: string }, times: number): string {
  return typeof value + ":" + String(value && value.name) + ":" + String(times);
}`,
    },
    plugins: [erases()],
    prints: "object:typed:2 string:undefined:undefined object:5:x object:null:undefined\n",
  },
  "imports that only the answer has, and imports that only the file has": {
    files: {
      "main.ts": `import { view } from "./view";
console.log(view({ title: "page" }));`,
      "view.tsx": `import type { Props } from "./props";
import { unused } from "./unused";
export type Unused = typeof unused;
export function view(props: Props): string { return props.title; }`,
      "props.ts": `export type Props = { title: string };
console.log("props.ts does not run");`,
      "unused.ts": `export const unused = 1;
console.log("unused.ts does not run");`,
      "helper.js": `export function wrap(text) { return "<" + text + ">"; }`,
    },
    plugins: [
      erases(
        `text => 'import { wrap } from "./helper.js";\\n' + text.replace(/import.*unused.*/, "").replace("return props.title", "return wrap(props.title)")`,
      ),
    ],
    prints: "<page>\n",
  },
  "such a file imports another, through a file that only exports again": {
    files: {
      "main.ts": `import { Page, type PageProps } from "./index";
const props: PageProps = { items: [{ label: "a" }, { label: "b" }] };
console.log(Page(props));`,
      "index.ts": `export * from "./page";
export type { Item } from "./item";`,
      "page.tsx": `import { Row, type Item } from "./item";
export type PageProps = { items: Item[] };
export function Page(props: PageProps): string { return props.items.map(Row).join("|"); }`,
      "item.tsx": `export type Item = { label: string };
export function Row(item: Item): string { return "[" + item.label + "]"; }`,
    },
    plugins: [erases()],
    prints: "[a]|[b]\n",
  },
  "the entry point is such a file": {
    files: {
      "main.tsx": `import { twice, type Count } from "./twice";
const count: Count = 4;
console.log(twice(count)${isWindows ? "" : ", import.meta.main"});`,
      "twice.tsx": `export type Count = number;
export function twice(count: Count): Count { return count * 2; }`,
    },
    options: `entrypoints: ["./main.tsx"]`,
    plugins: [erases()],
    prints: isWindows ? "8\n" : "8 true\n",
  },
  "a default export, and a JavaScript file that imports it": {
    files: {
      "main.ts": `import App, { type AppProps } from "./app";
import { fromJavaScript } from "./plain.js";
const props: AppProps = { name: "app" };
console.log(App(props), fromJavaScript());`,
      "app.tsx": `export type AppProps = { name: string };
export default function App(props: AppProps): string { return "hello " + props.name; }`,
      "plain.js": `import App from "./app";
export function fromJavaScript() { return App({ name: 7 }); }`,
    },
    plugins: [erases()],
    prints: "hello app hello 7\n",
  },
  // Without `aot` the executable holds one file, which has the name of the executable.
  "a stack trace and the name of the module": {
    files: {
      "main.ts": `import { fail, where } from "./fails";
try { fail(); } catch (error) { console.log((error as Error).message, /fails\\.tsx/.test((error as Error).stack ?? "")); }
console.log(where().split(/[\\\\/]/).pop()!.replace(/\\.exe$/, ""));`,
      "fails.tsx": `export function fail(): never { throw new Error("failed"); }
export function where(): string { return import.meta.path; }`,
    },
    plugins: [erases()],
    prints: "failed false\nplain\n",
    differs: { stdout: "failed true\nfails.tsx\n" },
  },
  // The build checks what it compiles.
  "a type error inside of the file on disk": {
    files: {
      "main.ts": `import { size } from "./size";
console.log(size);`,
      "size.tsx": `export const size: number = "large";`,
    },
    plugins: [erases()],
    prints: "large\n",
  },
  "an importer that does not fit the file on disk": {
    files: {
      "main.ts": `import { size } from "./size";
const text: string = size;
console.log(text);`,
      "size.tsx": `export const size: number = 1;`,
    },
    plugins: [erases()],
    refused: "TS2322",
  },
  "an answer that is TypeScript has the types of the answer": {
    files: {
      "main.ts": `import { size, type Size } from "./size";
const mine: Size = "large";
console.log(size, mine);`,
      "size.tsx": `export type Size = number;
export const size: Size = 1;`,
    },
    plugins: [
      `build.onLoad({ filter: /size\\.tsx$/ }, () => ({ contents: 'export type Size = string; export const size: Size = "small";', loader: "ts" }));`,
    ],
    prints: "small large\n",
  },
});

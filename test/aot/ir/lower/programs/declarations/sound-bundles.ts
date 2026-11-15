// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// Bundles: JavaScript as the bundler prints it, with the types of its sources put back.
import { watch } from "./augments";
import { Machine, depth, everything, leaf, mark, paint, pick, sum, type Tree } from "./constants";
import { Polite, serve, type Server } from "./greeter";
import * as spaces from "./namespaces";

(globalThis as any).injected = 4;

const server: Server = { port: 8080, options: { name: "world", loud: true } };
console.log("classes and interfaces:", serve(server, "a", "b"), new Polite("hi").greet({ name: "you" }, 2).join());

const tree: Tree = { kind: everything.Kind.Branch, left: leaf(1), right: leaf(2) };
console.log("inlined enum members:", sum(tree), depth(tree, 3), paint(), paint(everything.Color.Blue), new Machine().step(), new Machine().first);
const marked = mark({}, "n");
console.log("unique symbols:", marked.name, Object.getOwnPropertySymbols(marked).length, String(pick("KEY")), String(pick("OTHER")));
console.log("constants:", pick("NAME"), pick("COUNT"), pick("NIL"), pick("NOTHING"), everything.used());
console.log("a namespace object:", Object.keys(everything).join(), typeof everything.Unused);
console.log("enum objects:", JSON.stringify(everything.Kind), JSON.stringify(everything.Color));

const made = spaces.box(4);
console.log("another bundle:", made.get(), String(spaces.pick("NAME")), spaces.names().join(), spaces.everything.used());
console.log("its class through the namespace object:", new spaces.everything.Box("x").get(), spaces.everything.Color.Blue, Object.getOwnPropertySymbols(made).length);
console.log("a global that is augmented:", Object.keys(watch(1)).length, Object.getOwnPropertySymbols(watch(1)).length);

// FILE: augments.ts
// src/index.ts
declare global {
  interface SymbolConstructor {
    readonly watched: symbol;
  }
  interface Array<T> {
    lastOf?: Last<T>;
  }
}
type Last<T> = () => T;
interface Watched<T> {
  [Symbol.watched]: () => T;
}
function watch<T>(value: T): Partial<Watched<T>> {
  return typeof Symbol.watched === "symbol" ? { [Symbol.watched]: () => value } : {};
}
export {
  watch
};


// FILE: constants.ts
type Kind = Kind3;
declare namespace Kind { export type Leaf = Kind3.Leaf; export type Branch = Kind3.Branch; }
type Color = Color3;
declare namespace Color { export type Red = Color3.Red; export type Blue = Color3.Blue; }
declare const KEY2: unique symbol;
declare const OTHER2: unique symbol;
declare const exports_keys2: { COUNT: typeof COUNT; Color: typeof Color; KEY: typeof KEY; Kind: typeof Kind; NAME: typeof NAME; NIL: typeof NIL; NOTHING: typeof NOTHING; OTHER: typeof OTHER; Unused: typeof Unused; used: typeof used };
export type { Marked };
export type { Tools };
export type { Tree };
var __defProp = Object.defineProperty;
var __returnValue = (v: any) => v;
function __exportSetter(this: any, name: any, newValue: any) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target: any, all: any) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/keys.ts
var exports_keys: any = {};
__export(exports_keys, {
  COUNT: () => COUNT,
  Color: () => Color,
  KEY: () => KEY,
  Kind: () => Kind,
  NAME: () => NAME,
  NIL: () => NIL,
  NOTHING: () => NOTHING,
  OTHER: () => OTHER,
  Unused: () => Unused,
  used: () => used
});
var KEY: typeof KEY2 = Symbol.for("key") as typeof KEY2;
var OTHER: typeof OTHER2 = Symbol("other") as typeof OTHER2;
var NAME = "name" as const;
var COUNT = -3 as const;
var NIL: undefined = undefined;
var NOTHING: null = null;
var Kind!: typeof Kind3;
((Kind2: any) => {
  Kind2[Kind2["Leaf"] = 0] = "Leaf";
  Kind2[Kind2["Branch"] = 1] = "Branch";
})(Kind ||= {} as any);
declare enum Kind3 { Leaf, Branch }
declare enum Color3 { Red = "red", Blue = "blue" }
var Color!: typeof Color3;
((Color2: any) => {
  Color2["Red"] = "red";
  Color2["Blue"] = "blue";
})(Color ||= {} as any);

abstract class Unused {
abstract run(): void
}
function used(): number {
  return COUNT;
}

// src/index.ts
declare const injected: number;
interface Marked { [KEY]?: boolean; [OTHER]: number; name: string }
type Tools = { Unused: typeof Unused; used: typeof used };
interface Leaf { kind: Kind3.Leaf; value: number }
interface Branch { kind: Kind3.Branch; left: Tree; right: Tree }
type Tree = Leaf | Branch;
function sum(tree: Tree): number {
  switch (tree.kind) {
    case 0 as Kind3.Leaf /* Leaf */:
      return tree.value;
    case 1 as Kind3.Branch /* Branch */:
      return sum(tree.left) + sum(tree.right);
  }
}
function leaf(value: number): Tree {
  return { kind: 0 as Kind3.Leaf /* Leaf */, value };
}
function paint(color: Color3 = "red" as Color3.Red /* Red */): Color3 {
  return color === ("blue" as Color3.Blue) /* Blue */ ? "red" as Color3.Red /* Red */ : "blue" as Color3.Blue as Color3 /* Blue */;
}
function mark(target: object, name: unknown): Marked {
  const marked = target as Marked;
  (target as { [KEY]?: boolean })[KEY] = true;
  marked[OTHER] = used() + injected;
  const record: Record<typeof NAME, string> = { [NAME]: "x" };
  return { name: name as string, [OTHER]: record[NAME].length, [KEY]: NIL ?? NOTHING ?? undefined };
}
function pick(name: keyof typeof exports_keys2): unknown {
  return exports_keys[name];
}
function depth(tree: Tree, flag: number): number {
  const first = tree.kind === (1 as Kind3.Branch) /* Branch */ ? +flag : -flag;
  return first + (flag & (1 as Kind3.Branch) /* Branch */ | flag);
}

class Machine {
  state: Kind3 = 0 as Kind3.Leaf /* Leaf */;
  readonly first = 0 as Kind3.Leaf /* Leaf */;
  step(next: Color3 = "red" as Color3.Red /* Red */): Kind3 {
    let color: Color3 = "blue" as Color3.Blue /* Blue */;
    color = next;
    this.state = color === ("red" as Color3.Red) /* Red */ ? 1 as Kind3.Branch /* Branch */ : 0 as Kind3.Leaf /* Leaf */;
    return this.state;
  }
}
export {
  Machine,
  depth,
  exports_keys as everything,
  leaf,
  mark,
  paint,
  pick,
  sum
};


// FILE: greeter.ts
// src/mood.ts
declare enum Mood2 {
  Happy,
  Sad = 5,
}
type Options = Mood2[];
type Options2 = { name: string; loud?: boolean };
interface Greeter<T extends Options2 = Options2> {
  greet(options: T): string;
}
type Mood = Mood2;
declare namespace Mood { export type Happy = Mood2.Happy; export type Sad = Mood2.Sad; }
export type { Server };
export type { Options2 as Options };
var Mood!: typeof Mood2;
((Mood: any) => {
  Mood[Mood["Happy"] = 0] = "Happy";
  Mood[Mood["Sad"] = 5] = "Sad";
})(Mood ||= {} as any);

// src/polite.ts
class Polite implements Greeter {
  public mood: Mood2;
  private moods?: Options;
  private count: number = 0;
  readonly prefix: string;
  static made = 0;
  constructor(prefix: string, mood: Mood2 = 0 as Mood2.Happy /* Happy */, moods?: Options) {
    this.mood = mood;
    this.moods = moods;
    this.prefix = prefix;
  }
  greet(options: Options2): string;
  greet(options: Options2, times: number): string[];
  greet(options: Options2, times?: number): string | string[] {
    this.count++;
    const text = (options.loud ? options.name.toUpperCase() : options.name) as string;
    const line = this.prefix + " " + text!;
    return times === undefined ? line : new Array<string>(times).fill(line);
  }
  get total(): number {
    return this.count + (this.moods ?? []).length;
  }
}

// src/index.ts
interface Server {
  port: number;
  options: Options2;
  greeter?: Greeter;
}
function pick({ port, options }: Server, fallback: number = 80): [number, Options2] {
  return [port ?? fallback, options];
}
function serve<S extends Server>(server: S, ...rest: string[]): string {
  const [port, options] = pick(server);
  const greeter: Greeter = server.greeter ?? new Polite("hello", 5 as Mood2.Sad /* Sad */);
  const seen = new Map<string, number>;
  seen.set(options.name, rest.length);
  const handlers: Array<(options: Options2) => string> = [(options) => greeter.greet(options), function(this: void, options: Options2) {
    return options.name;
  }];
  return handlers.map((handler) => handler(options)).join(",") + port + (seen.get(options.name) as number);
}
export {
  Mood,
  Polite,
  serve
};


// FILE: namespaces.ts
type Boxed = Box<number>;
type Color = Color3;
declare namespace Color { export type Red = Color3.Red; export type Blue = Color3.Blue; }
declare const KEY2: unique symbol;
declare namespace exports_keys { export type { Boxed }; }
declare const exports_keys2: { Box: typeof Box; Color: typeof Color; KEY: typeof KEY; NAME: typeof NAME; used: typeof used };
var __defProp = Object.defineProperty;
var __returnValue = (v: any) => v;
function __exportSetter(this: any, name: any, newValue: any) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target: any, all: any) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/keys.ts
var exports_keys: any = {};
__export(exports_keys, {
  Box: () => Box,
  Color: () => Color,
  KEY: () => KEY,
  NAME: () => NAME,
  used: () => used
});
var NAME = "name" as const;
var KEY: typeof KEY2 = Symbol.for("key") as typeof KEY2;
declare enum Color3 { Red = "red", Blue = "blue" }
var Color!: typeof Color3;
((Color2: any) => {
  Color2["Red"] = "red";
  Color2["Blue"] = "blue";
})(Color ||= {} as any);
function used(): number {
  return NAME.length;
}

class Box<T> {
  public value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
}

// src/index.ts
function pick(name: keyof typeof exports_keys2): unknown {
  return exports_keys[name];
}
function box(value: number): Boxed {
  const made = new Box(value);
  (made as { [KEY]?: boolean })[KEY] = true;
  return made;
}
function names(): string[] {
  return Object.keys(Color).concat(Object.keys(exports_keys));
}
export {
  box,
  exports_keys as everything,
  names,
  pick
};


// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

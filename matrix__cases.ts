// Each case: files of a project. `index.ts` is the entry. Built with --define __DEV__=false.
const D = `declare const __DEV__: boolean;\n`;
export const cases: Record<string, Record<string, string>> = {
  "local-types": {
    "index.ts": `${D}export function make(): number {
  interface Point { x: number }
  class Local {
    at;
    both;
    constructor(p: Point) { this.both = p; if (__DEV__) this.at = p; }
  }
  return new Local({ x: 1 }).both.x;
}
`,
  },
  "generics": {
    "index.ts": `${D}export class Box<T, K extends string = string> {
  one;
  list;
  map;
  fn;
  constructor(value: T, key: K) {
    if (__DEV__) {
      this.one = value;
      this.list = [value];
      this.map = new Map<K, T>();
      this.fn = (next: T): K => key;
    }
  }
}
`,
  },
  "shadowed": {
    "item.ts": `export class Item { a = 1; }\n`,
    "index.ts": `${D}import { Item } from "./item";
export class Box {
  item;
  constructor() { if (__DEV__) this.item = new Item(); }
  count(): number {
    const Item = 1;
    return Item;
  }
}
export function other(): number {
  class Item { b = 2; }
  return new Item().b;
}
`,
  },
  "namespaces": {
    "shapes.ts": `export interface Circle { r: number }\nexport class Square { s = 1; }\n`,
    "index.ts": `${D}import * as shapes from "./shapes";
export namespace Sizes { export interface Size { w: number } export const zero: Size = { w: 0 }; }
declare const circle: shapes.Circle;
export class Box {
  circle;
  square;
  size;
  constructor() {
    if (__DEV__) {
      this.circle = circle;
      this.square = new shapes.Square();
      this.size = Sizes.zero;
    }
  }
}
`,
  },
  "class-expression": {
    "index.ts": `${D}interface Opt { a: number }
declare const opt: Opt;
export const Box = class {
  opt;
  constructor() { if (__DEV__) { this.opt = opt; } }
};
export default class {
  opt;
  constructor() { if (__DEV__) this.opt = opt; }
}
`,
  },
  "merged": {
    "index.ts": `${D}export enum Kind { A, B }
export namespace Kind { export function parse(text: string): Kind { return text === "a" ? Kind.A : Kind.B; } }
export interface Box { extra: string }
export class Box {
  kind;
  one;
  constructor() { if (__DEV__) { this.kind = Kind.parse("a"); this.one = Kind.A as const; } }
}
`,
  },
  "global-collision": {
    "index.ts": `${D}export class Map { size = 0; }
declare const real: globalThis.Map<string, number>;
declare const set: Set<string>;
export class Box {
  mine;
  real;
  set;
  date;
  constructor() {
    if (__DEV__) { this.mine = new Map(); this.real = real; this.set = set; this.date = new Date(); }
  }
}
`,
  },
  "two-modules-same-name": {
    "a.ts": `export class Item { a = 1; }\nexport type Mode = "a";\nexport enum Unit { Px }\n`,
    "b.ts": `export class Item { b = 2; }\nexport type Mode = "b";\nexport enum Unit { Em }\n`,
    "index.ts": `${D}import * as a from "./a";
import { Item, Unit } from "./b";
import type { Mode } from "./b";
import { Item as AItem, Unit as AUnit } from "./a";
import type { Mode as AMode } from "./a";
declare const mode: Mode;
declare const amode: AMode;
export class Box {
  item; aitem; unit; aunit; mode; amode;
  constructor() {
    if (__DEV__) {
      this.item = new Item(); this.aitem = new AItem();
      this.unit = Unit.Em as Unit; this.aunit = AUnit.Px as AUnit;
      this.mode = mode; this.amode = amode;
    }
  }
}
export { a };
`,
  },
  "function-types": {
    "index.ts": `${D}interface Opt { a: number }
const helper = (opt: Opt): string => "";
function named(this: void, a: number, ...rest: string[]): Opt { return { a }; }
export class Box {
  helper; named; pair; guard; ctor; over;
  constructor() {
    if (__DEV__) {
      this.helper = helper;
      this.named = named;
      this.pair = [helper, named] as const;
      this.guard = (value: unknown): value is Opt => true;
      this.ctor = Box;
      this.over = { run(a: number): Opt { return { a }; }, [Symbol.iterator]: 1 };
    }
  }
}
`,
  },
  "modifiers": {
    "index.ts": `${D}interface Opt { a: number }
declare const opt: Opt;
export abstract class Base {
  protected held;
  private secret;
  static shared;
  static #count;
  #hidden;
  readonly fixed;
  static made = 1;
  static readonly tag = "base";
  abstract later: Opt;
  declare ambient: Opt;
  static { if (__DEV__) { this.shared = opt; this.#count = 1; } }
  constructor() {
    this.fixed = opt;
    if (__DEV__) { this.held = opt; this.secret = opt; this.#hidden = opt; }
  }
  read(): unknown { return [this.secret, this.#hidden, Base.#count, Base.made, Base.tag]; }
}
export class Derived extends Base {
  later: Opt = opt;
  extra;
  constructor() { super(); if (__DEV__) this.extra = opt; }
}
`,
  },
  "accessor-then-bare": {
    "index.ts": `${D}interface Opt { a: number }
declare const opt: Opt;
export class Box {
  accessor first = 1;
  after;
  accessor bare;
  last;
  static accessor made = 2;
  constructor() { if (__DEV__) { this.after = opt; this.bare = opt; this.last = opt; } }
}
`,
  },
  "utility-types": {
    "index.ts": `${D}interface Opt { a: number; b?: string }
declare const part: Partial<Opt>;
declare const ro: Readonly<Opt>;
declare const rec: Record<string, Opt>;
declare const pick: Pick<Opt, "a">;
function make() { return { a: 1, nested: { deep: true } }; }
export class Box {
  part; ro; rec; pick; made; ret; arr; tuple; tmpl; key; idx; prom;
  constructor() {
    if (__DEV__) {
      this.part = part; this.ro = ro; this.rec = rec; this.pick = pick;
      this.made = make();
      this.ret = null as ReturnType<typeof make> | null;
      this.arr = [] as ReadonlyArray<Opt>;
      this.tuple = [1, "a", part] as [number, string, Partial<Opt>];
      this.tmpl = "a-b" as \`\${string}-\${string}\`;
      this.key = "a" as keyof Opt;
      this.idx = 1 as Opt["a"];
      this.prom = Promise.resolve(part);
    }
  }
}
`,
  },
  "symbols": {
    "index.ts": `${D}const tag: unique symbol = Symbol("tag");
export class Box {
  tag; sym; big; nev;
  constructor() {
    if (__DEV__) {
      this.tag = tag; this.sym = Symbol("x"); this.big = 1n;
      this.nev = [] as never[];
    }
  }
}
`,
  },
  "kept-stores": {
    "item.ts": `export class Item { a = 1; }\n`,
    "index.ts": `import { Item } from "./item";
interface Opt { a: number }
export class Box {
  item; opt; list; count; label;
  constructor(opt: Opt) {
    this.item = new Item();
    this.opt = opt;
    this.list = [new Item()];
    this.count = 0;
    this.label = opt.a > 0 ? "pos" : null;
  }
  next(): number { return ++this.count + this.item.a + this.list.length; }
}
`,
  },
  "narrowed-stores": {
    "index.ts": `interface Opt { a: number }
export class Box {
  value;
  either;
  constructor(opt: Opt | null, on: boolean) {
    if (on) this.value = opt; else this.value = 1;
    this.either = on ? opt : "none";
  }
  set(text: string): void { this.either = text; }
}
`,
  },
  "default-export-and-reexport": {
    "item.ts": `export default class Item { a = 1; }\nexport class Other { b = 2; }\n`,
    "index.ts": `${D}import Item, { Other } from "./item";
export default class Box {
  item; other;
  constructor() { if (__DEV__) { this.item = new Item(); this.other = new Other(); } }
}
export { Item, Other };
export * from "./item";
`,
  },
  "object-types": {
    "index.ts": `${D}interface Opt { a: number }
declare const opt: Opt;
export class Box {
  obj; nested; method; index; opt2; ro; quoted;
  constructor() {
    if (__DEV__) {
      this.obj = { opt, n: 1 };
      this.nested = { a: { b: { opt } } };
      this.method = { run(): Opt { return opt; } };
      this.index = {} as { [key: string]: Opt };
      this.opt2 = {} as { a?: Opt; readonly b: Opt };
      this.ro = [opt] as readonly Opt[];
      this.quoted = { "two words": opt, 0: opt };
    }
  }
}
`,
  },
  "valued-statics-and-computed": {
    "index.ts": `const key = "dynamic";
export enum Unit { Px, Em }
export class Plain {
  static count = 0;
  static readonly kind = "plain";
  static unit = Unit.Px;
  n = 1;
  label = "x";
  readonly fixed = Unit.Em;
  next(): number { return ++Plain.count + this.n; }
}
export class Keyed {
  [key] = 0;
  static made = 1;
  n = 1;
  readonly kind = "keyed";
}
`,
  },
};

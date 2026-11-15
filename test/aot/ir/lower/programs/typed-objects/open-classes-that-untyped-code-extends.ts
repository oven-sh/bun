// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="say"
// CHECK-LABEL: function {{*}}name="Early"

// FILE: main.ts
// Open classes that only untyped code extends.
import { Core, describe, rename, Made, widthOf, makeOne } from "./core.ts";
import { Heir, Further, anything, viaUnknownValue, look, Small, Smaller, isOne } from "./untyped.js";
import { sizeOf, type OnlyExtended } from "./core.ts";

function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

say("an heir", () => look(new Heir({ name: "a" })));
say("an heir of the heir", () => look(new Further({ name: "bb", base: "/x", limit: 9 })));
say("its own field comes last", () => Object.keys(new Further({ name: "c" })).slice(-2));
say("steps", () => {
  const heir = new Heir({ name: "d" });
  return [heir.step(1), heir.step(2), heir.count, heir.committed];
});
say("typed functions take it", () => {
  const heir: Core = anything(new Heir({ name: "e" }));
  rename(heir, "renamed");
  return [describe(heir), heir.later, Object.keys(heir).includes("later")];
});
say("private members", () => {
  const heir = new Heir({ name: "f" });
  return [heir.secret(), heir.secret(), heir.reveal(), Core.is(heir), Core.is({})];
});
say("a private member of a stranger", () => Core.prototype.secret.call({}));
say("a method on a stranger", () => Core.prototype.step.call({ count: 1, committed: [], limit: 2, base: "ab", origin: "c" }, 3));
say("by a value nobody knows", () => {
  const made = viaUnknownValue([Heir, Core, Further], 1, { name: "g" });
  return [look(made), made.step(4), made.secret(), made.reveal(), Object.getPrototypeOf(made) === Core.prototype];
});
say("Reflect.construct, itself", () => look(Reflect.construct(Core, [{ name: "h" }])));
say("Reflect.construct, a function for target", () => {
  function Target() {}
  Target.prototype = { tag: "target" };
  const first = Reflect.construct(Core, [{ name: "i" }], Target);
  Target.prototype = { tag: "another" };
  const second = Reflect.construct(Core, [{ name: "j" }], Target);
  return [first.tag, second.tag, first.origin, second.origin, first instanceof Core];
});
say("many, each its own", () => {
  let total = 0;
  const all: Core[] = [];
  for (let i = 0; i < 3000; i++) {
    const heir: Core = i % 3 ? new Heir({ name: "n" + (i & 7) }) : new Further({ name: "m", limit: i });
    total += heir.step(i & 3);
    if (i % 500 === 0) all.push(heir);
  }
  all[0].marks.h = true;
  all[0].listeners.add("x");
  return [total, all.map((heir) => describe(heir)), all[1].marks, all[1].listeners.size, all[0].listeners.size];
});
say("fields are there before the constructor's stores", () => {
  class Early extends (anything(Core) as typeof Core) {
    constructor() {
      super({ name: "early" });
    }
  }
  return Object.keys(new Early());
});
say("deleted", () => {
  const heir = new Heir({ name: "k" }) as any;
  delete heir.key;
  return [describe(heir), Object.keys(heir).join(), heir.step(1)];
});
say("frozen", () => {
  const heir = Object.freeze(new Heir({ name: "l" }));
  return [Object.isFrozen(heir), (() => { try { heir.step(1); return "stored"; } catch (error) { return (error as Error).constructor.name; } })(), heir.count];
});
say("a class that typed code makes keeps its layout", () => {
  let total = 0;
  for (let i = 0; i < 100; i++) total += widthOf(anything(makeOne(i))) + widthOf(anything(new Made(1)));
  return total;
});
say("a class that is only extended", () => {
  const small: OnlyExtended = anything(new Small(3));
  const smaller: OnlyExtended = anything(new Smaller(5));
  small.late = "late";
  return [small.grow(1), smaller.grow(2), sizeOf(small), sizeOf(smaller), Object.keys(small).join(), Object.keys(smaller).join(), isOne(small), isOne({}), sizeOf(anything({ label: "plain", size: 1, seen: [] }))];
});
say("many of them", () => {
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    const one: OnlyExtended = i & 1 ? new Small(i) : new Smaller(i);
    total += one.grow(i & 3) + one.seen.length;
  }
  return total;
});

// FILE: core.ts
export interface Settings {
  name: string;
  base?: string;
  limit?: number;
}

export class Core {
  key: string | undefined = "k";
  marks: { n: boolean; h?: boolean } = { n: true };
  listeners = new Set<string>();
  committed: Array<number> = [];
  settings!: Settings;
  origin!: string;
  base!: string;
  limit!: number;
  later?: string;
  count = 0;
  #secret = 7;
  constructor(settings: Settings) {
    this.update({ limit: 5, ...settings });
  }
  update = (next: Settings) => {
    this.settings = { ...this.settings, ...next };
    this.base = this.settings.base ?? "/";
    this.origin = "http://" + this.settings.name;
    this.limit = this.settings.limit ?? 1;
  };
  step(n: number): number {
    this.count += n;
    this.committed.push(n);
    return this.count + this.limit + this.base.length + this.origin.length;
  }
  secret(): number {
    return this.#secret++;
  }
  #hidden(): string {
    return "hidden " + this.base;
  }
  reveal(): string {
    return this.#hidden();
  }
  static is(value: unknown): boolean {
    return value instanceof Core;
  }
}

export function describe(core: Core): string {
  return core.origin + core.base + " " + core.count + " " + core.limit + " " + core.key + " " + core.later;
}

export function rename(core: Core, name: string): void {
  core.update({ name });
  core.later = name;
}

export class Made {
  width: number;
  constructor(width: number) {
    this.width = width;
  }
  twice(): number {
    return this.width * 2;
  }
}

export function widthOf(made: Made): number {
  return made.width + made.twice();
}

export function makeOne(width: number): Made {
  return new Made(width);
}

export class OnlyExtended {
  label: string = "only";
  size!: number;
  seen: Array<string> = [];
  late?: string;
  constructor(size: number) {
    this.size = size;
  }
  grow(by: number): number {
    this.size += by;
    this.seen.push(this.label + this.size);
    return this.size;
  }
}

export function sizeOf(one: OnlyExtended): string {
  return one.label + " " + one.size + " " + one.seen.length + " " + one.late;
}

// FILE: untyped.js
import { Core, Made, describe, rename, widthOf, makeOne } from "./core.ts";

export class Heir extends Core {
  constructor(settings) {
    super(settings);
    this.extra = settings.name.length;
  }
  step(n) {
    return super.step(n) + 1000;
  }
}

export class Further extends Heir {
  own = "further";
}

export function anything(value) {
  return value;
}

export function viaUnknownValue(classes, index, settings) {
  const Chosen = classes[index];
  return new Chosen(settings);
}

export function look(core) {
  return [describe(core), Object.keys(core).join(), JSON.stringify(core.settings), core instanceof Core, core.constructor.name];
}

export { Core, Made, describe, rename, widthOf, makeOne };

import { OnlyExtended, sizeOf } from "./core.ts";

export class Small extends OnlyExtended {
  constructor(size) {
    super(size);
    this.more = size * 2;
  }
}

export class Smaller extends Small {}

export function isOne(value) {
  return value instanceof OnlyExtended;
}

export { sizeOf };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

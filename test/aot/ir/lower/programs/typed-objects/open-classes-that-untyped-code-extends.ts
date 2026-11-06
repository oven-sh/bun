// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

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

// GENERATED: say Early
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v11) handler=b9():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v12 = String string="undefined"
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b5(v13) handler=b9():
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14) handler=b9():
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b9():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b10(v15)
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = String string="throws "
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = PropGet v18 key="constructor"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = PropGet v20 key="name"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v23 = Add v17, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25: undefined|null|string):
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = String string=": "
// CHECK-NEXT: v32 = Add v0, v31
// CHECK-NEXT: v33 = Add v32, v25
// CHECK-NEXT: v34 = Call v30, v28, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = Data data=[[d_8]]
// CHECK-NEXT: v5 = SuperConstruct v3, v1, v4 layout=[[L_9]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=DerivedConstructorResult name="Early"
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b10(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v23
// CHECK-NEXT: }

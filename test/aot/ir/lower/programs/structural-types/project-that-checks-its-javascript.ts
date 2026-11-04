// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
import { Basket, counter, double, makePoint, settings, sizes, spoil, total } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

attempt("honest", () => [plusOne(1), size("ab"), double(2), total([1, 2]), makePoint(1, 2).x, new Basket().add(1), counter.next(), sizes.small]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(double(i)) + total([i, 1]) + makePoint(i, 1).x + sizes.small;
console.log("2000 honest rounds", warm);

attempt("inferred results", () => [plusOne(double(2)), plusOne(total([1, 2])), plusOne(makePoint(1, 2).y), size(settings.name), plusOne(settings.depth)]);
attempt("an inferred class", () => {
  const b = new Basket();
  b.add(1);
  b.add(2);
  return [b.items, plusOne(b.sum()), Object.keys(b)];
});
spoil();
attempt("after the module spoiled its own values: settings", () => [settings.depth, plusOne(settings.depth), settings.name]);
attempt("after: a string member", () => size(settings.name));
attempt("after: sizes", () => [sizes.small, plusOne(sizes.small)]);
attempt("after: the counter", () => [counter.next(), plusOne(counter.next())]);
attempt("after: double", () => [double(2), plusOne(double(2))]);
attempt("after: a basket", () => {
  const b = new Basket();
  b.add(1);
  return [b.items, b.sum(), plusOne(b.sum())];
});
attempt("honest again", () => [plusOne(1), size("ab")]);

// FILE: library.js
let factor = 2;

/** @param {number} n */
export function double(n) {
  return n * factor;
}

/** @param {number[]} list */
export function total(list) {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

/**
 * @param {number} x
 * @param {number} y
 */
export function makePoint(x, y) {
  return { x, y };
}

export const settings = { depth: 1, name: "settings" };
export const sizes = Object.freeze({ small: 1, large: 2 });

export const counter = {
  count: 0,
  next() {
    return ++this.count;
  },
};

export class Basket {
  constructor() {
    /** @type {number[]} */
    this.items = [];
  }

  /** @param {number} n */
  add(n) {
    return this.items.push(n);
  }

  sum() {
    return total(this.items);
  }
}

/**
 * @this {Basket}
 * @param {number} n
 */
function replacement(n) {
  return this.items.push(JSON.parse('"' + n + '"'));
}

export function spoil() {
  factor = JSON.parse('"two"');
  settings.depth = JSON.parse('"deep"');
  settings.name = JSON.parse("null");
  counter.count = JSON.parse('"c"');
  Basket.prototype.add = replacement;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// GENERATED: plusOne size attempt
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: PropSet v3, v4 key="length"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="->"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = Call v1 calleeName="run"
// CHECK-NEXT: v14 = Call v12, -, v13 calleeName="show"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="log"
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = String string=" "
// CHECK-NEXT: v19 = Call v17, v16, v18 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Call v10, v8, v0, v11, v14, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = String string="threw"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="Error" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v32 = InstanceOf v22, v31
// CHECK-NEXT: v33 = ToBoolean v32
// CHECK-NEXT: Branch v33 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v34):
// CHECK-NEXT: v35 = PropGet v22 key="constructor"
// CHECK-NEXT: v36 = PropGet v35 key="name"
// CHECK-NEXT: Jump -> next b5(v36)
// CHECK-NEXT: b4(v37):
// CHECK-NEXT: v38 = TypeOf v22
// CHECK-NEXT: Jump -> next b5(v38)
// CHECK-NEXT: b5(v39):
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v41 = CheckInitialized v40 name="log"
// CHECK-NEXT: v42 = PropGet v41 key="join"
// CHECK-NEXT: v43 = String string=" "
// CHECK-NEXT: v44 = Call v42, v41, v43 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v46 = Call v27, v25, v0, v28, v39, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }

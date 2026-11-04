// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Overloads and generics in a declaration file lie.
import { assertText, first, get, identity, isNumber, make, mapAll, pair, Store } from "./library.js";

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

attempt("honest", () => [plusOne(1), size("ab")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab");
console.log("2000 honest rounds", warm);

attempt("an overload that promises a number", () => [get("count"), plusOne(get("count")), typeof get("count")]);
attempt("an overload that promises a string", () => [get("name"), get("name") + "!", typeof get("name")]);
attempt("an overload that promises a string: size", () => size(get("name")));
attempt("an overload that promises a list", () => get("list").length);
attempt("identity of a number", () => [identity(5), plusOne(identity(5)), typeof identity(5)]);
attempt("identity of a string", () => [identity("abc"), typeof identity("abc")]);
attempt("identity of a string: size", () => size(identity("abc")));
attempt("identity of an object", () => {
  const p = identity({ x: 1 });
  return [p.x, plusOne(p.x), Object.keys(p)];
});
attempt("first of a list", () => [typeof first([1, 2]), plusOne(first([1, 2]))]);
attempt("mapAll swaps the arguments", () => mapAll(["a", "bb"], (item, index) => typeof item + ":" + typeof index));
attempt("mapAll: the callback uses its parameters", () => mapAll(["a", "bb"], (item, index) => item.length + index));
attempt("mapAll: a named typed callback", () => {
  const measure = (item: string, index: number): number => item.length * 10 + index;
  return [measure("ab", 1), mapAll(["a", "bb"], measure)];
});
attempt("make", () => [make("dog").legs, plusOne(make("dog").legs), make("cat").lives, Object.keys(make("dog"))]);
attempt("a guard that always says yes", () => {
  const values: unknown[] = [1, "2", null];
  return values.map(v => (isNumber(v) ? v + 1 : "no"));
});
attempt("an assertion that never throws", () => {
  const v: unknown = 5;
  assertText(v);
  return [v + "!", typeof v];
});
attempt("an assertion that never throws: size", () => {
  const v: unknown = 5;
  assertText(v);
  return size(v);
});
attempt("a pair the wrong way round", () => {
  const [n, s] = pair(1, "one");
  return [typeof n, typeof s, pair(1, "one").length];
});
attempt("a pair the wrong way round: used", () => {
  const [n, s] = pair(1, "one");
  return [plusOne(n), s + "!"];
});
attempt("a pair the wrong way round: a method", () => pair(1, "one")[1].toUpperCase());
attempt("a generic class", () => {
  const store = new Store<string, number>();
  const returned = store.set("a", 1);
  return [typeof returned, store.get("a"), plusOne(store.get("a")), store.size, plusOne(store.size), store.get("b")];
});
attempt("a generic class: chained", () => new Store<string, number>().set("a", 1).set("b", 2).size);
attempt("honest again", () => [plusOne(1), size("ab")]);

// FILE: library.d.ts
export declare function get(key: "count"): number;
export declare function get(key: "name"): string;
export declare function get(key: "list"): number[];
export declare function identity<T>(value: T): T;
export declare function first<T>(list: T[]): T;
export declare function mapAll<T, U>(list: T[], f: (item: T, index: number) => U): U[];
export declare function make(kind: "dog"): { legs: number };
export declare function make(kind: "cat"): { lives: number };
export declare function isNumber(value: unknown): value is number;
export declare function assertText(value: unknown): asserts value is string;
export declare function pair<A, B>(a: A, b: B): [A, B];
export declare class Store<K, V> {
  set(key: K, value: V): this;
  get(key: K): V;
  readonly size: number;
}

// FILE: library.js
export function get(key) {
  return key === "count" ? "many" : key === "name" ? 7 : undefined;
}

export function identity(value) {
  return typeof value === "number" ? String(value) : typeof value === "string" ? value.length : { wrapped: value };
}

export function first(list) {
  return list;
}

export function mapAll(list, f) {
  return Array.from(list, (item, index) => f(index, item));
}

export function make(kind) {
  return kind === "dog" ? { lives: 9 } : { legs: 4 };
}

export function isNumber(value) {
  return true;
}

export function assertText(value) {}

export function pair(a, b) {
  return [b, a, "extra"];
}

export class Store {
  #items = new Map();
  set(key, value) {
    this.#items.set(String(key), String(value));
    return undefined;
  }
  get(key) {
    return this.#items.get(String(key));
  }
  get size() {
    return String(this.#items.size);
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: attempt measure
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
// CHECK-LABEL: function {{*}}name="measure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Integer integer=10
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Add v4, v1
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }

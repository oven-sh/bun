// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A declared function that never returns comes back.
import { absent, assertNumber, assertPresent, assertTrue, fail, Guard, impossible, isText, nil, nothing } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function afterFail(): string {
  fail("first");
  return "the statement after the call ran";
}

function resultOfFail(): unknown {
  const result = fail("second");
  return [typeof result, result];
}

function narrowedByFail(n: number | undefined): number {
  if (n === undefined) fail("third");
  return n + 1;
}

function everyPathFails(n: number): number {
  if (n > 0) return n;
  fail("fourth");
}

function inASwitch(kind: "a" | "b"): number {
  switch (kind) {
    case "a":
      return 1;
    default:
      fail("fifth");
  }
}

function assigned(flag: boolean): number {
  let n: number;
  if (flag) n = 1;
  else fail("sixth");
  return n + 1;
}

function asserted(v: unknown): unknown {
  assertNumber(v);
  return [v + 1, v * 2, typeof v];
}

function present(p: { x: number } | null | undefined): number {
  assertPresent(p);
  return p.x;
}

function condition(v: string | number): number {
  assertTrue(typeof v === "string");
  return v.length;
}

function guarded(v: unknown): unknown {
  return isText(v) ? [v.length, v + "!"] : "no text";
}

function afterAMethod(): string {
  const guard: Guard = new Guard();
  guard.stop();
  return "the statement after the method ran";
}

function checkedByAMethod(v: unknown): unknown {
  const guard: Guard = new Guard();
  guard.check(v);
  return [v.length, v + "!"];
}

function thisIsReady(): unknown {
  const guard = new Guard();
  return guard.ready() ? [guard.level, guard.level + 1] : "not ready";
}

attempt("after a call", afterFail);
attempt("its result", resultOfFail);
attempt("narrowed", () => [narrowedByFail(1), narrowedByFail(undefined)]);
attempt("every path", () => [everyPathFails(1), everyPathFails(0), everyPathFails(0) + 1]);
attempt("in a switch", () => [inASwitch("a"), inASwitch("b")]);
attempt("a variable that was never assigned", () => [assigned(true), assigned(false)]);
attempt("an assertion for numbers", () => [asserted(1), asserted("1"), asserted(null), asserted([2])]);
attempt("an assertion that something is there", () => present({ x: 1 }));
attempt("an assertion that something is there, null", () => present(null));
attempt("an assertion of a condition", () => [condition("ab"), condition(5)]);
attempt("a guard", () => [guarded("ab"), guarded([1, 2]), guarded(5)]);
attempt("a guard, null", () => guarded(null));
attempt("after a method", afterAMethod);
attempt("checked by a method", () => [checkedByAMethod("ab"), checkedByAMethod(7)]);
attempt("this is ready", thisIsReady);
attempt("a constant of type never", () => [typeof impossible, show(impossible)]);
attempt("void, undefined and null", () => {
  const a = nothing();
  const b = absent();
  const c = nil();
  return [show(a), typeof a, b === undefined, typeof b, b ?? "fallback", c === null, typeof c, c ?? "fallback"];
});

// FILE: library.d.ts
export declare function fail(message: string): never;
export declare function assertNumber(value: unknown): asserts value is number;
export declare function assertPresent<T>(value: T): asserts value is NonNullable<T>;
export declare function assertTrue(condition: unknown): asserts condition;
export declare function isText(value: unknown): value is string;
export declare class Guard {
  stop(): never;
  check(value: unknown): asserts value is string;
  ready(): this is Ready;
}
export declare class Ready extends Guard {
  level: number;
}
export declare const impossible: never;
export declare function nothing(): void;
export declare function absent(): undefined;
export declare function nil(): null;

// FILE: library.js
export function fail(message) {
  return "came back: " + message;
}

export function assertNumber(value) {}

export function assertPresent(value) {}

export function assertTrue(condition) {
  return condition;
}

export function isText(value) {
  return true;
}

export class Guard {
  stop() {
    return "came back";
  }
  check(value) {}
  ready() {
    return true;
  }
}

export class Ready extends Guard {
  level = 1;
}

export const impossible = "here";

export function nothing() {
  return "something";
}

export function absent() {
  return 5;
}

export function nil() {
  return { x: 1 };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: everyPathFails inASwitch asserted thisIsReady
// CHECK-LABEL: function {{*}}name="everyPathFails"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Greater v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="fail"
// CHECK-NEXT: v8 = String string="fourth"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="fail"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_2]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inASwitch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"a"|"b" site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|"a"|"b"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["a"] -> case b2(| 0), otherwise b4()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="fail"
// CHECK-NEXT: v6 = String string="fifth"
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="fail"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_5]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="assertNumber"
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="assertNumber"
// CHECK-NEXT: v4 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Mul v4, v7
// CHECK-NEXT: v9 = TypeOf v4
// CHECK-NEXT: v10 = NewArray v6, v8, v9 contents=anything
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="thisIsReady"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Guard"
// CHECK-NEXT: v2 = Construct v1 calleeName="Guard"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="ready"
// CHECK-NEXT: v5 = Call v4, v3 calleeKey="ready" calleeName="guard.ready"
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v3 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="level"
// CHECK-NEXT: v11 = PropGet v9 key="level"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = NewArray v10, v13 contents=anything
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = String string="not ready"
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }

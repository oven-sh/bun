// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
import { Box, count, double, name, origin } from "./values.js";

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

attempt("which file was loaded", () => origin);
attempt("honest", () => [plusOne(1), size("ab")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab");
console.log("2000 honest rounds", warm);
attempt("count", () => [count, typeof count, plusOne(count), count + 1]);
attempt("name", () => [name, typeof name, name + "!"]);
attempt("name: size", () => size(name));
attempt("double", () => [double(2), plusOne(double(2)), [1, 2].map(double)]);
attempt("a class", () => {
  const b = new Box();
  return [b.value, b.get(), plusOne(b.get()), plusOne(b.value), Object.keys(b)];
});
attempt("honest again", () => [plusOne(1), size("ab")]);

// FILE: values.js
export const count = "one";
export const name = 7;
export function double(n) {
  return String(n) + String(n);
}
export class Box {
  constructor() {
    this.held = "js";
  }
  get() {
    return this.held;
  }
}
export const origin = "values.js";

// FILE: values.ts
export const count: number = 1;
export const name: string = "typescript";
export function double(n: number): number {
  return n * 2;
}
export class Box {
  value = 1;
  get(): number {
    return this.value;
  }
}
export const origin = "values.ts";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: plusOne size attempt
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_10]]}
// CHECK-NEXT: PropSet v3, v5 key="length"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="->"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v14 = Call v1 calleeName="run"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="show"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="log"
// CHECK-NEXT: v19 = PropGet v18 key="join"
// CHECK-NEXT: v20 = String string=" "
// CHECK-NEXT: v21 = Call v19, v18, v20 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Call v11, v9, v0, v12, v16, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="threw"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="Error" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v34 = InstanceOf v24, v33 writtenExpression="error instanceof Error"
// CHECK-NEXT: v35 = ToBoolean v34
// CHECK-NEXT: Branch v35 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v36):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v37 = Convert v24 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="constructor"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|function site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: v40 = PropGet v39 key="name"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v41)
// CHECK-NEXT: b7(v42):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v43 = TypeOf v24
// CHECK-NEXT: Jump -> next b9(v43)
// CHECK-NEXT: b9(v44):
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="log"
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = String string=" "
// CHECK-NEXT: v49 = Call v47, v46, v48 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v51 = Call v29, v27, v0, v30, v44, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: Return v52
// CHECK-NEXT: }

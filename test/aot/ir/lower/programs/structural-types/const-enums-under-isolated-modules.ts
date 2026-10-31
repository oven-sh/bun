// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
import { Bit, describe, Level } from "./levels.ts";
import { isHigh, kept, Rank, Bit as SameBit } from "./again.ts";
import * as levels from "./levels.ts";
import * as again from "./again.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function bitsOf(bit: Bit): number {
  return bit | 0;
}

attempt("levels", () => [Level.Low, Level.Middle, Level.High, Level.Minus, Level.Text]);
attempt("by a quoted name", () => [Level["Low"], Level["Text"], Bit["Both"]]);
attempt("bits", () => [Bit.None, Bit.A, Bit.B, Bit.Both, Bit.Top, Bit.Wide, Bit.Half]);
attempt("under another name", () => [Rank.Low, Rank.High, Rank.Text, SameBit.Top, Rank.High === Level.High]);
attempt("described", () => [describe(Level.Low), describe(Level.Minus), describe(Level.Text), describe(Rank.Middle)]);
attempt("kept", () => [kept, kept.map(describe), kept.map(isHigh)]);
attempt("bits of", () => [bitsOf(Bit.Top), bitsOf(Bit.Wide), bitsOf(Bit.Half), bitsOf(Bit.Both)]);
attempt("the names a module exports", () => [Object.keys(levels).sort(), Object.keys(again).sort()]);
attempt("a number outside", () => {
  const n: number = 3;
  const level: Level = n;
  return [level, describe(level), typeof describe(level), isHigh(level)];
});
attempt("a fraction as a bit", () => {
  const n: number = 2.5;
  const bit: Bit = n;
  return [bit, bitsOf(bit), bit === Bit.B, bit & Bit.B];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += describe(i % 2 ? Level.Low : Level.High).length + bitsOf(i % 2 ? Bit.A : Bit.Top);
console.log("2000 rounds", warm);

// FILE: again.ts
export { Level as Rank, Bit } from "./levels.ts";
import { Level } from "./levels.ts";

export const kept: Level[] = [Level.Low, Level.High, Level.Text];
export function isHigh(level: Level): boolean {
  return level === Level.High;
}

// FILE: levels.ts
export const enum Level {
  Low = 1,
  Middle = Low * 2,
  High = Middle << 2,
  Minus = -High,
  Text = "text",
}

export const enum Bit {
  None = 0,
  A = 1 << 0,
  B = 1 << 1,
  Both = A | B,
  Top = 1 << 31,
  Wide = 2 ** 31,
  Half = 1 / 2,
}

export function describe(level: Level): string {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.Middle:
      return "middle";
    case Level.High:
      return "high";
    case Level.Minus:
      return "minus";
    case Level.Text:
      return "text";
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "isolatedModules": true }, "files": [] }

// GENERATED: bitsOf attempt
// CHECK-LABEL: function {{*}}name="bitsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = BitOr v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Call v6, v4, v0, v7, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="threw"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="Error" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v23 = InstanceOf v13, v22 writtenExpression="error instanceof Error"
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="constructor"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = TypeOf v13
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v18, v16, v0, v19, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }

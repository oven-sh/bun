// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
import { Name, Plain, Unit } from "./units.ts";
import * as units from "./units.ts";

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

function inUnits(size: number, unit: Unit): number {
  return size / unit;
}
function whole(unit: Unit): number {
  return unit | 0;
}
function label(name: Name): string {
  return name === Name.Byte ? "bytes" : "kilobytes";
}

attempt("units", () => [Unit.Byte, Unit.Kilo, Unit.Mega, Unit.Giga, Unit.Tera]);
attempt("names", () => [Name.Byte, Name.Kilo, label(Name.Byte), label(Name.Kilo)]);
attempt("a plain enum made of them", () => [Plain.One, Plain.Thousand, Plain.Huge, Plain[1024], Plain[Unit.Tera], Object.keys(Plain)]);
attempt("in units", () => [inUnits(4096, Unit.Kilo), inUnits(1, Unit.Tera), inUnits(3, Unit.Byte)]);
attempt("whole", () => [whole(Unit.Giga), whole(Unit.Tera), whole(Unit.Mega)]);
attempt("the names the module exports", () => Object.keys(units).sort());
attempt("a number that is no unit", () => {
  const n: number = 0;
  const unit: Unit = n;
  return [inUnits(5, unit), inUnits(0, unit), whole(unit)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += inUnits(i, i % 2 ? Unit.Kilo : Unit.Byte) + whole(Unit.Mega);
console.log("2000 rounds", warm);

// FILE: units.ts
export const enum Unit {
  Byte = 1,
  Kilo = 1024,
  Mega = Kilo * Kilo,
  Giga = Mega * Kilo,
  Tera = Giga * Kilo,
}

export const enum Name {
  Byte = "B",
  Kilo = "KB",
}

export enum Plain {
  One = Unit.Byte,
  Thousand = Unit.Kilo,
  Huge = Unit.Tera,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "preserveConstEnums": true }, "files": [] }

// GENERATED: inUnits whole label attempt
// CHECK-LABEL: function {{*}}name="inUnits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=int[-2147483648, 1099511627776] site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: number, v1: int[-2147483648, 1099511627776]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="whole"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=int[-2147483648, 1099511627776] site=[[w_4]]}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: int[-2147483648, 1099511627776]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = BitOr v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"B"|"KB" site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"B"|"KB"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="B"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="bytes"
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = String string="kilobytes"
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_9]]):
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
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_13]]} illTypedCause=Assertion
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

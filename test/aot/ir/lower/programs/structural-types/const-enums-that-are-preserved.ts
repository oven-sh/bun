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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=int[-2147483648, 1099511627776]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number, v1: int[-2147483648, 1099511627776]):
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="whole"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=int[-2147483648, 1099511627776]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: int[-2147483648, 1099511627776]):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = BitOr v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"B"|"KB" flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"B"|"KB"):
// CHECK-NEXT: v1 = String string="B"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="bytes"
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = String string="kilobytes"
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = Call v1 calleeName="run"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="show"
// CHECK-NEXT: v11 = Call v6, v4, v0, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v12 = CatchValue
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="threw"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="Error" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v22 = InstanceOf v12, v21
// CHECK-NEXT: v23 = ToBoolean v22
// CHECK-NEXT: Branch v23 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v24):
// CHECK-NEXT: v25 = PropGet v12 key="constructor"
// CHECK-NEXT: v26 = PropGet v25 key="name"
// CHECK-NEXT: Jump -> next b5(v26)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: v28 = TypeOf v12
// CHECK-NEXT: Jump -> next b5(v28)
// CHECK-NEXT: b5(v29):
// CHECK-NEXT: v30 = Call v17, v15, v0, v18, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }

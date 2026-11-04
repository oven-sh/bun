// RUN: lower
// OPTIONS: builtin-modules

// An exhaustive switch over parsed data falls off its end.
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "box"; w: number; h: number };

enum Color {
  Red,
  Green,
  Blue,
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.r * s.r * 3;
    case "square":
      return s.side * s.side;
    case "box":
      return s.w * s.h;
  }
}

function areaPlusOne(s: Shape): number {
  return area(s) + 1;
}

function named(s: Shape): string {
  if (s.kind === "circle") return "round";
  if (s.kind === "square") return "even";
  if (s.kind === "box") return "long";
  const rest: never = s;
  return "none of them: " + typeof rest + " " + JSON.stringify(rest);
}

function colorName(c: Color): string {
  switch (c) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    case Color.Blue:
      return "blue";
  }
}

function yesOrNo(b: boolean): string {
  switch (b) {
    case true:
      return "yes";
    case false:
      return "no";
  }
}

function level(l: "low" | "high"): number {
  switch (l) {
    case "low":
      return 1;
    case "high":
      return 2;
  }
}

function kindOf(v: string | number): string {
  if (typeof v === "string") return "text " + v.length;
  if (typeof v === "number") return "number " + (v + 1);
  const rest: never = v;
  return "neither: " + typeof rest;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += area({ kind: "circle", r: i }) + area({ kind: "square", side: i }) + area({ kind: "box", w: i, h: 2 });
  warm += colorName(i % 3).length + yesOrNo(i % 2 === 0).length + level(i % 2 === 0 ? "low" : "high") + kindOf(i).length + named({ kind: "square", side: 1 }).length;
}
console.log("2000 honest rounds: " + warm);

const shapes = [
  '{"kind":"circle","r":2}',
  '{"kind":"triangle","r":2}',
  '{"kind":"Circle","r":2}',
  '{"kind":1,"r":2}',
  '{"kind":null}',
  "{}",
  '{"r":2,"kind":"circle"}',
  '{"kind":"circle"}',
  '{"kind":"circle","r":"2"}',
  '{"kind":"square","r":2}',
  '{"kind":"box","w":2}',
  '{"kind":["circle"],"r":2}',
  "[]",
  '"circle"',
  "5",
];
for (const text of shapes) {
  attempt("area of " + text, () => area(JSON.parse(text)));
  attempt("area plus one of " + text, () => areaPlusOne(JSON.parse(text)));
  attempt("name of " + text, () => named(JSON.parse(text)));
}
attempt("area of null", () => area(JSON.parse("null")));

for (const text of ["0", "2", "3", "-1", "1.5", '"1"', '"Red"', "null", "true", "[1]"]) {
  attempt("color " + text, () => colorName(JSON.parse(text)));
  attempt("color " + text + ", its length", () => colorName(JSON.parse(text)).length);
}
for (const text of ["true", "false", "1", "0", '"true"', "null", "[]"]) attempt("yes or no " + text, () => yesOrNo(JSON.parse(text)));
for (const text of ['"low"', '"high"', '"middle"', '""', "1", "null", '["low"]']) attempt("level " + text, () => [level(JSON.parse(text)), level(JSON.parse(text)) + 1]);
for (const text of ['"ab"', "1", "true", "null", "[1]", "{}"]) attempt("kind of " + text, () => kindOf(JSON.parse(text)));

console.log("honest again: " + [area({ kind: "circle", r: 1 }), named({ kind: "box", w: 1, h: 1 }), colorName(Color.Blue), yesOrNo(false), level("high"), kindOf("a")].join(" "));

export {};

// GENERATED: level attempt
// CHECK-LABEL: function {{*}}name="level"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"high"|"low" flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|"high"|"low"):
// CHECK-NEXT: SwitchString v0 strings=["low", "high"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: Return v8
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
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }

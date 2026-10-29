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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"high"|"low" site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|"high"|"low"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["low", "high"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_2]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v8
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
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }

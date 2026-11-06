// RUN: lower
// OPTIONS: builtin-modules

// Rest parameters typed as unions of tuples get tuples that were changed.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

type Line = [kind: "line", x: number, y: number];
type Circle = [kind: "circle", radius: number];
type Stop = [kind: "stop"];
type Move = Line | Circle | Stop;

function draw(...move: Move): string {
  const seen = move.length + " given: " + move.map(text).join(", ") + " -> ";
  switch (move[0]) {
    case "line":
      return seen + "line to " + text(move[1] + move[2]);
    case "circle":
      return seen + "circle of " + text(move[1] * 2);
    case "stop":
      return seen + "stop";
  }
}

function byLength(...move: Move): string {
  if (move.length === 3) return "three: " + text(move[1] + move[2]);
  if (move.length === 2) return "two: " + text(move[1].toFixed(1));
  return "one: " + move[0].toUpperCase();
}

function named(...[kind, first = -1, second = -2]: Move): string {
  return text(kind) + " " + text(first) + " " + text(second);
}

function mixed(...parts: [id: number, note?: string, ...flags: boolean[]]): string {
  const [id, note, ...flags] = parts;
  return parts.length + " | " + text(id) + " | " + text(note) + " | " + text(flags) + " | " + (note === undefined ? "no note" : text(note.length));
}

attempt("honest line", () => draw("line", 1, 2));
attempt("honest circle", () => draw("circle", 3));
attempt("honest stop", () => draw("stop"));

const functions: [string, (...move: Move) => string][] = [
  ["draw", draw],
  ["by length", byLength],
  ["named", named],
];

const changes: [string, (line: Line) => void][] = [
  ["untouched", () => {}],
  ["popped", line => void line.pop()],
  ["popped twice", line => {
    line.pop();
    line.pop();
  }],
  ["emptied by splice", line => void line.splice(0)],
  ["pushed", line => void line.push(9)],
  ["reversed", line => void line.reverse()],
  ["shifted", line => void line.shift()],
  ["sorted", line => void line.sort()],
  ["filled", line => void line.fill(7, 1)],
  ["a hole", line => void Reflect.deleteProperty(line, 1)],
  ["the kind of a circle by copyWithin", line => void line.copyWithin(0, 1)],
];

for (const [name, f] of functions) {
  for (const [label, change] of changes) {
    const line: Line = ["line", 1, 2];
    change(line);
    attempt(name + ", " + label, () => f(...line));
    attempt(name + ", " + label + ", by apply", () => f.apply(null, line));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += draw("line", i, 1).length + draw("circle", i).length + draw("stop").length;
console.log("2000 honest rounds: " + warm);
const late: Circle = ["circle", 4];
late.pop();
attempt("a circle without a radius after them", () => draw(...late));

attempt("mixed(1)", () => mixed(1));
attempt("mixed(1, undefined)", () => mixed(1, undefined));
attempt("mixed(1, 'n')", () => mixed(1, "n"));
attempt("mixed(1, 'n', true, false)", () => mixed(1, "n", true, false));
attempt("mixed(1, undefined, true)", () => mixed(1, undefined, true));
const parts: [number, string?, ...boolean[]] = [1, "n", true];
parts.reverse();
attempt("mixed, reversed", () => mixed(...parts));
parts.length = 0;
attempt("mixed, emptied", () => mixed(...parts));

const moves: Move[] = [["line", 1, 2], ["circle", 3], ["stop"]];
attempt("a list of moves", () => moves.map(move => draw(...move)));
for (const move of moves) move.reverse();
attempt("the list, each reversed", () => moves.map(move => draw(...move)));

// GENERATED: failure attempt
// CHECK-LABEL: function {{*}}name="failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="threw "
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Error" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v5 = InstanceOf v0, v4 writtenExpression="error instanceof Error"
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="constructor"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = Call v14, -, v0 calleeName="text"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: v18 = Add v1, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v24 = Call v23, -, v15 calleeName="failure"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = Add v22, v25
// CHECK-NEXT: v27 = Call v20, v18, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }

// RUN: lower
// OPTIONS: builtin-modules

// The first and the last line of a stack: errors made in small functions that get inlined, in constructors, getters and callbacks, at every limit, read the first time and again.
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : (frame[2] ?? "").replace(/^new /, "")) + ":" + frame[3]);
  }
  return frames.join(" | ");
}
let calls = 0;
function tiny(): Error {
  const error = new Error("tiny");
  calls++;
  return error;
}
function callsTiny(): Error {
  const error = tiny();
  calls++;
  return error;
}
function callsTinyTwice(second: boolean): Error {
  const a = tiny();
  const b = tiny();
  calls++;
  return second ? b : a;
}
function threeLevels(): Error {
  const error = callsTiny();
  calls++;
  return error;
}
class Shape {
  error: Error;
  constructor() {
    this.error = new Error("in a constructor");
  }
  get problem(): Error {
    const error = new RangeError("in a getter");
    calls++;
    return error;
  }
  static make(): Shape {
    const shape = new Shape();
    calls++;
    return shape;
  }
  method(): Error {
    const error = tiny();
    calls++;
    return error;
  }
}
class Square extends Shape {
  side: number;
  constructor() {
    super();
    this.side = 1;
  }
}
class Failure extends Error {
  code: number;
  constructor(message: string) {
    super(message);
    this.code = 7;
  }
}
class WorseFailure extends Failure {
  constructor() {
    super("worse");
  }
}
function fails(): Failure {
  const failure = new Failure("failed");
  calls++;
  return failure;
}
function failsWorse(): Failure {
  const failure = new WorseFailure();
  calls++;
  return failure;
}
const makers: Array<[string, () => Error]> = [
  ["tiny", tiny],
  ["callsTiny", callsTiny],
  ["first of two", () => { const e = callsTinyTwice(false); calls++; return e; }],
  ["second of two", () => { const e = callsTinyTwice(true); calls++; return e; }],
  ["threeLevels", threeLevels],
  ["constructor", () => { const e = new Shape().error; calls++; return e; }],
  ["static method", () => { const e = Shape.make().error; calls++; return e; }],
  ["derived constructor", () => { const e = new Square().error; calls++; return e; }],
  ["getter", () => { const e = new Shape().problem; calls++; return e; }],
  ["method", () => { const e = new Shape().method(); calls++; return e; }],
  ["subclass of Error", fails],
  ["subclass of a subclass", failsWorse],
  ["callback", () => { const e = [1].map(() => { const inner = tiny(); calls++; return inner; })[0]!; return e; }],
];
function under(depth: number, maker: () => Error): Error {
  if (depth) {
    const error = under(depth - 1, maker);
    calls++;
    return error;
  }
  const error = maker();
  calls++;
  return error;
}
class Builder {
  built: Error;
  constructor(depth: number, maker: () => Error) {
    this.built = under(depth, maker);
  }
}
Error.stackTraceLimit = 10;
for (const [name, maker] of makers) {
  const seen = new Set<string>();
  for (let round = 0; round < 3; round++) seen.add(names(maker()).replace(/map:\d+ \| /, ""));
  console.log(name + ": " + seen.size + " " + [...seen][0]);
}
for (const limit of [1, 2, 3, 4, 5, 9, 10, 11]) {
  Error.stackTraceLimit = limit;
  const lines: string[] = [];
  for (const depth of [0, 1, 2, 3, 7, 8, 9]) {
    const plain = names(under(depth, callsTiny)).split(" | ");
    const built = names(new Builder(depth, fails).built).split(" | ");
    lines.push(depth + "=" + plain.length + "," + plain[plain.length - 1] + "," + built.length + "," + built[built.length - 1]);
  }
  console.log("limit " + limit + ": " + lines.join(" "));
}
console.log(calls);

// GENERATED: problem method Builder WorseFailure
// CHECK-LABEL: function {{*}}name="problem"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="in a getter"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="calls"
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_2]]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="calls"
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_1]]
// CHECK-NEXT: v13 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = Call v0 calleeName="tiny"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="calls"
// CHECK-NEXT: v5 = Increment v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="calls"
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_1]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Builder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_4]]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v8 = Call v7, -, v1, v2 calleeName="under"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v9 key="built"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="WorseFailure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = String string="worse"
// CHECK-NEXT: v5 = SuperConstruct v3, v1, v4 layout=[[L_11]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b9(v20) frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=DerivedConstructorResult name="WorseFailure"
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b10(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v23
// CHECK-NEXT: }

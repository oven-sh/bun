// RUN: lower
// OPTIONS: builtin-modules

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
}

function isSquare(s: Shape): s is Square {
  return s instanceof Square;
}

function isNumber(v: number | string): v is number {
  return typeof v === "number";
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const spoil: Between = h => {
  h.shape = new Shape();
  h.value = "text";
};

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["equal to true", (h, between) => (isSquare(h.shape) === true ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
  ["not equal to false", (h, between) => (isSquare(h.shape) !== false ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
  ["equal to false, the other branch", (h, between) => (isSquare(h.shape) === false ? "other" : (between(h), [h.shape.edge, h.shape.edge * 2]))],
  ["true on the left", (h, between) => (true === isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["loosely equal to true", (h, between) => (isNumber(h.value) == true ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["negated twice", (h, between) => (!!isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["a test compared with true", (h, between) => ((typeof h.value === "number") === true ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["an instanceof compared with true", (h, between) => ((h.shape instanceof Square) === true ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("replaced", spoil);
round("honest again", keep);

// GENERATED: isSquare round Square spoil
// CHECK-LABEL: function {{*}}name="isSquare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Square"
// CHECK-NEXT: v3 = InstanceOf v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_3]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="uses"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v10 = IteratorOpen v8 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v11 = IteratorResume v10 stepIndex=0
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: v14 = IteratorResume v10 stepIndex=1
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: IteratorClose v10
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v0, v19
// CHECK-NEXT: v21 = Add v20, v13
// CHECK-NEXT: v22 = NewClosure v1, v16 function=[[f_6]]
// CHECK-NEXT: v23 = Call v18, -, v21, v22 calleeName="attempt"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b7() role=IterationCleanup subject=v10 handler=b8():
// CHECK-NEXT: v24 = CatchException
// CHECK-NEXT: IteratorClose v10 completion=Throw
// CHECK-NEXT: Rethrow v24
// CHECK-NEXT: b8() role=IterationCleanup subject=v4:
// CHECK-NEXT: v26 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spoil"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Shape"
// CHECK-NEXT: v3 = Construct v2 calleeName="Shape"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: PropSet v0, v4 key="shape"
// CHECK-NEXT: v6 = String string="text"
// CHECK-NEXT: PropSet v0, v6 key="value"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }

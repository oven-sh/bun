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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Square"
// CHECK-NEXT: v3 = InstanceOf v0, v2 writtenExpression="s instanceof Square"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="uses"
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Array<undefined|null|string|[[f_9]]> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = IteratorOpen v10 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v12 = IteratorResume v11 stepIndex=0
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v16 = IteratorResume v11 stepIndex=1
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_9]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: IteratorClose v11
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v22 = String string=": "
// CHECK-NEXT: v23 = Add v0, v22
// CHECK-NEXT: v24 = Add v23, v15
// CHECK-NEXT: v25 = NewClosure v1, v19 function=[[f_12]]
// CHECK-NEXT: v26 = Call v21, -, v24, v25 calleeName="attempt"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v11 handler=b12():
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v11 completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: b12() role=IterationCleanup subject=v4:
// CHECK-NEXT: v29 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_15]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spoil"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Shape"
// CHECK-NEXT: v3 = Construct v2 calleeName="Shape"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: PropSet v0, v4 key="shape"
// CHECK-NEXT: v6 = String string="text"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|number|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v7 key="value"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }

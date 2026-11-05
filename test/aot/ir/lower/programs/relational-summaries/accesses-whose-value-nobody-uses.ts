// RUN: lower
// OPTIONS: builtin-modules

// A read whose value is thrown away still runs the getter; a store of a constant still runs the setter. Every form of access that leaves no value behind for anybody to follow: an expression statement, `void`, a condition, an unused pattern, an update, a compound assignment, a target of a pattern or of a loop, an optional chain, `in`, `delete`.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Target {
  x: number;
  tag: string;
}
const kept: Target[] = [];
const log: string[] = [];
function plain(i: number): Target {
  return { x: i, tag: "plain " + i };
}
function spy(tag: string): Target {
  let value = 1;
  return {
    tag,
    get x() {
      kept.push(this);
      log.push("get");
      return value;
    },
    set x(v: number) {
      kept.push(this);
      log.push("set " + v);
      value = v;
    },
  };
}
class SpyClass {
  private value = 1;
  constructor(public tag: string) {}
  get x(): number {
    kept.push(this);
    log.push("get");
    return this.value;
  }
  set x(v: number) {
    kept.push(this);
    log.push("set " + v);
    this.value = v;
  }
}
const forms: [string, (o: Target) => void][] = [];
function statement(o: Target): void {
  o.x;
}
function voided(o: Target): void {
  void o.x;
}
function condition(o: Target): void {
  if (o.x) {
  }
}
function ternary(o: Target): number {
  return o.x ? 1 : 1;
}
function logical(o: Target): void {
  o.x && 0;
}
function comma(o: Target): number {
  return void o.x, 1;
}
function unusedPattern(o: Target): void {
  const { x } = o;
}
function unusedParameterPattern({ x }: Target): void {}
function restPattern(o: Target): number {
  const { tag, ...rest } = o;
  return 1;
}
function optional(o: Target | null): void {
  o?.x;
}
function byKey(o: Target): void {
  o["x"];
}
function byComputedKey(o: Target, key: "x" = "x"): void {
  o[key];
}
function typeofIt(o: Target): void {
  typeof o.x;
}
function inTemplate(o: Target): void {
  `${o.x}`;
}
function storesAConstant(o: Target): void {
  o.x = 5;
}
function storesZero(o: Target): void {
  o.x = 0;
}
function increments(o: Target): void {
  o.x++;
}
function decrementsInFront(o: Target): void {
  --o.x;
}
function compound(o: Target): void {
  o.x += 2;
}
function logicalAssignment(o: Target): void {
  o.x ||= 7;
  o.x &&= 8;
  o.x ??= 9;
}
function patternTarget(o: Target): void {
  [o.x] = [11];
}
function objectPatternTarget(o: Target): void {
  ({ a: o.x } = { a: 12 });
}
function loopTarget(o: Target): void {
  for (o.x of [13, 14]);
}
function loopInTarget(o: Target): void {
  for ((o as unknown as { x: string }).x in { k: 1 });
}
function byReflectGet(o: Target): void {
  Reflect.get(o, "x");
}
function byReflectSet(o: Target): void {
  Reflect.set(o, "x", 15);
}
function byAssign(o: Target): void {
  Object.assign(o, { x: 16 });
}
function byAssignFrom(o: Target): void {
  Object.assign({}, o);
}
function bySpread(o: Target): void {
  ({ ...o });
}
function byValues(o: Target): void {
  Object.values(o);
}
function switchOnIt(o: Target): void {
  switch (o.x) {
  }
}
function asArgumentNobodyTakes(o: Target): void {
  (() => {})(
    // @ts-ignore: the arrow takes nothing
    o.x,
  );
}
function whileCondition(o: Target): void {
  while (o.x > 1000);
}
function throwsAway(o: Target): void {
  try {
    throw o.x;
  } catch {}
}
forms.push(["statement", statement], ["void", voided], ["condition", condition], ["ternary", ternary], ["logical", logical], ["comma", comma], ["unused pattern", unusedPattern], ["unused parameter pattern", unusedParameterPattern], ["rest pattern", restPattern], ["optional", optional], ["by key", byKey], ["by computed key", byComputedKey], ["typeof", typeofIt], ["template", inTemplate]);
forms.push(["stores a constant", storesAConstant], ["stores zero", storesZero], ["increments", increments], ["decrements", decrementsInFront], ["compound", compound], ["logical assignment", logicalAssignment], ["pattern target", patternTarget], ["object pattern target", objectPatternTarget], ["loop target", loopTarget], ["for-in target", loopInTarget]);
forms.push(["Reflect.get", byReflectGet], ["Reflect.set", byReflectSet], ["assign to", byAssign], ["assign from", byAssignFrom], ["spread", bySpread], ["values", byValues], ["switch", switchOnIt], ["argument nobody takes", asArgumentNobodyTakes], ["while", whileCondition], ["thrown away", throwsAway]);

// Each form at a site of its own, with a fresh object, hot with plain objects and now and then with a spy.
for (let i = 0; i < 300; i++) {
  const o = (name: string): Target => (i % 100 === 99 ? (i === 199 ? new SpyClass(name + " " + i) : spy(name + " " + i)) : plain(i));
  statement(o("statement"));
  voided(o("void"));
  condition(o("condition"));
  ternary(o("ternary"));
  logical(o("logical"));
  comma(o("comma"));
  unusedPattern(o("unused pattern"));
  unusedParameterPattern(o("unused parameter pattern"));
  restPattern(o("rest pattern"));
  optional(o("optional"));
  byKey(o("by key"));
  byComputedKey(o("by computed key"));
  typeofIt(o("typeof"));
  inTemplate(o("template"));
  storesAConstant(o("stores a constant"));
  storesZero(o("stores zero"));
  increments(o("increments"));
  decrementsInFront(o("decrements"));
  compound(o("compound"));
  logicalAssignment(o("logical assignment"));
  patternTarget(o("pattern target"));
  objectPatternTarget(o("object pattern target"));
  loopTarget(o("loop target"));
  loopInTarget(o("for-in target"));
  byReflectGet(o("Reflect.get"));
  byReflectSet(o("Reflect.set"));
  byAssign(o("assign to"));
  byAssignFrom(o("assign from"));
  bySpread(o("spread"));
  byValues(o("values"));
  switchOnIt(o("switch"));
  asArgumentNobodyTakes(o("argument nobody takes"));
  whileCondition(o("while"));
  throwsAway(o("thrown away"));
}
console.log(churn(80), kept.length, log.length);
const seen = new Map<string, number>();
for (const k of kept) seen.set(k.tag, (seen.get(k.tag) ?? 0) + 1);
console.log([...seen].map(([tag, n]) => tag + ":" + n).join(" | "));
kept.length = 0;
log.length = 0;
for (const [name, form] of forms) {
  form(spy(name));
  console.log(name + ": " + log.splice(0).join(","));
}
console.log(churn(40), kept.length, new Set(kept).size);

// What does not read.
kept.length = 0;
function asksOnly(o: Target): string {
  return [("x" in o), Object.hasOwn(o, "x"), Object.keys(o).length, typeof Object.getOwnPropertyDescriptor(o, "x")!.get, o.hasOwnProperty("x"), Object.getOwnPropertyNames(o).length].join();
}
function removes(o: Partial<Target>): boolean {
  return delete o.x;
}
console.log(asksOnly(spy("asked")), removes(spy("removed")), kept.length, log.length);

// GENERATED: restPattern patternTarget byReflectGet asksOnly
// CHECK-LABEL: function {{*}}name="restPattern"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="tag"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="tag"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v7 = NewObject layout=[[L_5]]
// CHECK-NEXT: CopyDataProperties v7, v4 excludedKeys=["tag"]
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="patternTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_9]]
// CHECK-NEXT: v2 = IteratorOpen v1 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v3 = IteratorResume v2 stepIndex=0
// CHECK-NEXT: v4 = ResultAt v3
// CHECK-NEXT: v5 = ResultAt v3 index=1
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_10]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v0, v6 key="x"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: IteratorClose v2
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v10 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byReflectGet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectGet
// CHECK-NEXT: v3 = String string="x"
// CHECK-NEXT: v4 = Call v2, v1, v0, v3 calleeName="Reflect.get"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_13]]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asksOnly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropHas v0 key="x"
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = Call v3, v2, v0, v4 calleeName="Object.hasOwn"
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_16]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeName="Object.keys"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v14 = String string="x"
// CHECK-NEXT: v15 = Call v13, v12, v0, v14 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|number|string|symbol|bigint|[[L_18]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="get"
// CHECK-NEXT: v18 = TypeOf v17
// CHECK-NEXT: v19 = PropGet v0 key="hasOwnProperty"
// CHECK-NEXT: v20 = String string="x"
// CHECK-NEXT: v21 = Call v19, v0, v20 calleeKey="hasOwnProperty" calleeName="o.hasOwnProperty"
// CHECK-NEXT: v22 = Convert v21 declared={type=boolean site=[[w_19]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Builtin builtin=Object
// CHECK-NEXT: v24 = Builtin builtin=ObjectGetOwnPropertyNames
// CHECK-NEXT: v25 = Call v24, v23, v0 calleeName="Object.getOwnPropertyNames"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = PropGet v26 key="length"
// CHECK-NEXT: v28 = NewArray v1, v6, v11, v18, v22, v27 contents=undefined|null|boolean|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v29 = PropGet v28 key="join"
// CHECK-NEXT: v30 = Call v29, v28 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v30 casts=[{declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }

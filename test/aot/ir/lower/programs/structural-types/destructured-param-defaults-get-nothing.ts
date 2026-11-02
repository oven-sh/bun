// RUN: lower
// OPTIONS: builtin-modules

// Destructured parameters with defaults get nothing undefined and getters.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];
function effect<T>(label: string, value: T): T {
  log.push(label);
  return value;
}

function attempt(label: string, run: () => unknown): void {
  log = [];
  let outcome: string;
  try {
    outcome = text(run());
  } catch (error) {
    outcome = failure(error);
  }
  console.log(label + ": " + outcome + (log.length ? " [" + log.join(", ") + "]" : ""));
}

interface Box {
  width?: number;
  height?: number;
  label?: string | null;
}

function area({ width = effect("default width", 1), height = effect("default height", width * 2), label = "none" }: Box = effect("default box", {})): string {
  return text(width) + " x " + text(height) + " " + text(label);
}

attempt("area()", () => area());
attempt("area(undefined)", () => area(undefined));
attempt("area({})", () => area({}));
attempt("area({ width: 3 })", () => area({ width: 3 }));
attempt("area({ width: undefined })", () => area({ width: undefined }));
attempt("area({ height: 5 })", () => area({ height: 5 }));
attempt("area({ label: null })", () => area({ label: null }));
attempt("area({ width: 0, height: -0 })", () => area({ width: 0, height: -0 }));

class Watched implements Box {
  get height(): number | undefined {
    return effect("get height", undefined);
  }
  get width(): number {
    return effect("get width", 4);
  }
  get label(): string {
    return effect("get label", "watched");
  }
}
attempt("getters are read in the order of the pattern", () => area(new Watched()));
attempt("members on the prototype", () => area(Object.create({ width: 7 })));

const extras = { width: 2, height: 3, depth: 4 };
attempt("more members than the type", () => area(extras));

function rest({ width, ...others }: Box & { depth?: number }): string {
  return text(width) + " others " + text(others) + " keys " + Object.keys(others).join();
}
attempt("a rest in the pattern takes the extras too", () => rest(extras));
attempt("a rest over getters", () => rest(new Watched()));

function pair([a = effect("default a", 1), b = effect("default b", a + 1)]: [number?, number?] = []): string {
  return text(a) + ", " + text(b);
}
attempt("pair()", () => pair());
attempt("pair([])", () => pair([]));
attempt("pair([5])", () => pair([5]));
attempt("pair([undefined, 5])", () => pair([undefined, 5]));
attempt("pair([, 5])", () => pair([, 5]));

function nested({ inner: { deep = effect("default deep", 1) } = effect("default inner", {}) }: { inner?: { deep?: number } } = {}): string {
  return text(deep);
}
attempt("nested()", () => nested());
attempt("nested({})", () => nested({}));
attempt("nested({ inner: {} })", () => nested({ inner: {} }));
attempt("nested({ inner: { deep: 9 } })", () => nested({ inner: { deep: 9 } }));

function required({ width }: { width: number }): string {
  return text(width);
}
const looseRequired: (box?: { width: number }) => string = (box = { width: -1 }) => required(box);
attempt("a wrapper gives the default", () => looseRequired());
interface Takes {
  take(box?: { width: number }): string;
}
const takes: Takes = {
  take({ width }: { width: number }): string {
    return text(width);
  },
};
attempt("a pattern gets nothing through a method type", () => takes.take());
attempt("the same, given", () => takes.take({ width: 1 }));

function computed({ [effect("key", "width")]: value = effect("default", 0) }: Box): string {
  return text(value);
}
attempt("a computed key in the pattern", () => computed({ width: 6 }));
attempt("a computed key, absent", () => computed({}));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += area({ width: i & 3, height: 2 }).length;
log = [];
console.log("2000 honest calls: " + warm);
attempt("area() after them", () => area());

// GENERATED: effect rest Watched width take
// CHECK-LABEL: function {{*}}name="effect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] site=[[w_3]]}] results=[{type=undefined|null|[[L_2]] site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Convert v1 declared={type=undefined|null|[[L_2]] site=[[w_4]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="width"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="width"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v7 = NewObject layout=[[L_9]]
// CHECK-NEXT: CopyDataProperties v7, v4 excludedKeys=["width"]
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v12 = Call v11, -, v6 calleeName="text"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = String string=" others "
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v17 = Call v16, -, v10 calleeName="text"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = Add v15, v18
// CHECK-NEXT: v20 = String string=" keys "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = Builtin builtin=Object
// CHECK-NEXT: v23 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v24 = Call v23, v22, v10 calleeName="Object.keys"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Array<undefined|null|string> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = PropGet v25 key="join"
// CHECK-NEXT: v27 = Call v26, v25 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Add v21, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Watched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="width"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_15]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v1 = String string="get width"
// CHECK-NEXT: v2 = Integer integer=4
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="effect"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|[[L_2]] site=[[w_17]]}}, {declared={type=number site=[[w_15]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_18]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="width"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="width"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v8 = Call v7, -, v6 calleeName="text"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }

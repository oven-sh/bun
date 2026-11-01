// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2578 3

// Classes below built-in classes declare fields under the names that the parent's constructor, its prototype object or the engine defines on or above an instance.
const lines: string[] = [];
function attempt(read: () => unknown): string {
  try {
    const value = read();
    return typeof value + " " + (typeof value === "object" || typeof value === "function" ? "" : String(value));
  } catch (e) {
    return "throws " + (e as Error).name;
  }
}
class Failure extends Error {
  message: string = "mine";
  cause: number = 3;
  name: string = "Failure";
  stack: string = "no stack";
}
class Quiet extends Error {
  declare message: string;
  declare cause: number;
  code = 1;
}
class Sized extends Map<string, number> {
  // @ts-expect-error
  size: number = 40;
  // @ts-expect-error
  get: number = 41;
}
class Counted extends Set<string> {
  // @ts-expect-error
  has: string = "own";
}
class Pattern extends RegExp {
  lastIndex: number = 2;
  // @ts-expect-error
  source: string = "mine";
}
class Moment extends Date {
  // @ts-expect-error
  getTime: number = 7;
}
class Bytes extends Uint8Array {
  // @ts-expect-error
  length: number = 99;
  // @ts-expect-error
  byteLength: string = "own";
}
class Text extends String {
  extra: number = 5;
}
function failure(k: Failure): string {
  return [attempt(() => k.message), attempt(() => k.cause), attempt(() => k.name), attempt(() => k.stack), attempt(() => String(k)), attempt(() => Object.keys(k).join())].join(" | ");
}
function quiet(k: Quiet): string {
  return [attempt(() => k.message), attempt(() => k.cause), attempt(() => k.code), attempt(() => "cause" in k), attempt(() => Object.hasOwn(k, "message")), attempt(() => Object.keys(k).join())].join(" | ");
}
function sized(k: Sized): string {
  return [attempt(() => k.size), attempt(() => k.get), attempt(() => k.has("a")), attempt(() => Map.prototype.get.call(k, "a")), attempt(() => [...k.keys()].join()), attempt(() => Object.keys(k).join())].join(" | ");
}
function counted(k: Counted): string {
  return [attempt(() => k.has), attempt(() => k.size), attempt(() => Set.prototype.has.call(k, "a")), attempt(() => Object.keys(k).join())].join(" | ");
}
function pattern(k: Pattern): string {
  return [attempt(() => k.lastIndex), attempt(() => k.source), attempt(() => k.flags), attempt(() => k.test("aaaa")), attempt(() => k.lastIndex), attempt(() => Object.keys(k).join())].join(" | ");
}
function moment(k: Moment): string {
  return [attempt(() => k.getTime), attempt(() => k.valueOf()), attempt(() => k.toISOString()), attempt(() => Object.keys(k).join())].join(" | ");
}
function bytes(k: Bytes): string {
  return [attempt(() => k.length), attempt(() => k.byteLength), attempt(() => k[1]), attempt(() => k.join()), attempt(() => Object.keys(k).join())].join(" | ");
}
function text(k: Text): string {
  return [attempt(() => k.length), attempt(() => k.extra), attempt(() => k[1]), attempt(() => k + "!"), attempt(() => Object.keys(k).join())].join(" | ");
}
for (let round = 0; round < 3; round++) {
  lines.push(failure(new Failure("given", { cause: "given" })));
  lines.push(quiet(new Quiet("given")), quiet(new Quiet("given", { cause: 9 })), quiet(new Quiet()));
  lines.push(attempt(() => sized(new Sized([["a", 1]]))));
  lines.push(attempt(() => counted(new Counted(["a"]))));
  lines.push(attempt(() => pattern(new Pattern("a", "g"))));
  lines.push(attempt(() => moment(new Moment(86400000))));
  lines.push(attempt(() => bytes(new Bytes([1, 2, 3]))));
  lines.push(attempt(() => text(new Text("text"))));
  Bun.gc(true);
}
const kept = new Failure("kept");
(Error as any).captureStackTrace(kept);
lines.push(attempt(() => typeof kept.stack), failure(Object.assign(kept, { stack: "again" })));
console.log(lines.join("\n"));

// GENERATED: attempt counted Failure
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b13():
// CHECK-NEXT: v1 = Call v0 calleeName="read"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v5 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v6) handler=b13():
// CHECK-NEXT: Jump -> next b7(v6)
// CHECK-NEXT: b4(v7) handler=b13():
// CHECK-NEXT: v8 = TypeTest v7 testedType=null|object
// CHECK-NEXT: Branch v8 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v9) handler=b13():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b6(v10) handler=b13():
// CHECK-NEXT: Jump -> next b7(v10)
// CHECK-NEXT: b7(v11) handler=b13():
// CHECK-NEXT: v12 = TypeTest v11 testedType=function
// CHECK-NEXT: Branch v12 -> taken b8(| 0), notTaken b10(| 0)
// CHECK-NEXT: b8(v13) handler=b13():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: v14 = String string=""
// CHECK-NEXT: Jump -> next b12(v14)
// CHECK-NEXT: b10(v15) handler=b13():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11() handler=b13():
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v16, -, v15 calleeName="String"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b12(v18)
// CHECK-NEXT: b12(v19) handler=b13():
// CHECK-NEXT: v20 = Add v4, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: b13() role=CatchHandler:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = String string="throws "
// CHECK-NEXT: v24 = Convert v22 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = Add v23, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_10]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_12]]
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="attempt"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_14]]
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="attempt"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v14 = NewClosure v0 function=[[f_16]]
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="attempt"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = NewArray v4, v8, v12, v16 contents=undefined|null|string
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = String string=" | "
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_19]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_20]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }

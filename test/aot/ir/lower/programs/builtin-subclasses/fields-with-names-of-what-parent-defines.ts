// RUN: lower
// OPTIONS: builtin-modules

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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b11():
// CHECK-NEXT: v1 = Call v0 calleeName="read"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6) handler=b11():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b3(v7) handler=b11():
// CHECK-NEXT: v8 = TypeTest v7 testedType=null|object
// CHECK-NEXT: Branch v8 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v9) handler=b11():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b5(v10) handler=b11():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v11 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v11 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v12) handler=b11():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: v13 = String string=""
// CHECK-NEXT: Jump -> next b10(v13)
// CHECK-NEXT: b9(v14) handler=b11():
// CHECK-NEXT: v15 = NarrowByTest v1, v14
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v16, -, v15 calleeName="String"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b10(v18)
// CHECK-NEXT: b10(v19) handler=b11():
// CHECK-NEXT: v20 = Add v4, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: b11() role=CatchHandler:
// CHECK-NEXT: v22 = CatchValue
// CHECK-NEXT: v23 = String string="throws "
// CHECK-NEXT: v24 = Convert v22 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="attempt"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="attempt"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="attempt"
// CHECK-NEXT: v13 = NewArray v3, v6, v9, v12 contents=anything
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = String string=" | "
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }

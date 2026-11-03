// RUN: lower
// OPTIONS: builtin-modules

// The other side of allocation-stays-proven-in-constant: only what is seen to be made is proven without a test. A constant filled by a function of the program, by a cast, by a static that the program has put in the engine's place, or a variable that is stored to again, is not proven to hold what its written type says: a cast takes any object, undefined and null, so a look-alike goes through and its own members are read. A primitive throws a TypeError at the cast.
// VALIDATED compiles
function claim(value: unknown): ArrayBuffer { return value as ArrayBuffer }
function byACall(value: unknown): unknown { const buffer = claim(value); return buffer.byteLength }
function byACast(value: unknown): unknown { const buffer = value as ArrayBuffer; return buffer.byteLength }
function storedAgain(value: unknown): unknown { let buffer = new ArrayBuffer(4); if (value !== undefined) buffer = value as ArrayBuffer; return buffer.byteLength }
function shadowed(value: unknown): unknown {
  const Promise = { resolve(given: unknown): globalThis.Promise<number> { return given as globalThis.Promise<number> } };
  const settled = Promise.resolve(value);
  return typeof settled;
}
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } };
for (const value of [new ArrayBuffer(2), new Uint8Array(3), { byteLength: "many" }, "text", 5]) console.log(attempt(() => byACall(value)), attempt(() => byACast(value)), attempt(() => storedAgain(value)), attempt(() => shadowed(value)));
console.log(String(storedAgain(undefined)));

// GENERATED: byACall byACast storedAgain shadowed attempt resolve
// CHECK-LABEL: function {{*}}name="byACall"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="claim"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|ArrayBuffer site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = PropGet v3 key="byteLength"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byACast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|ArrayBuffer site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = PropGet v1 key="byteLength"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storedAgain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v2 = Integer integer=4
// CHECK-NEXT: v3 = Construct v1, -, v2 calleeName="ArrayBuffer"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|ArrayBuffer site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|ArrayBuffer site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b5(v9: undefined|null|ArrayBuffer):
// CHECK-NEXT: v10 = PropGet v9 key="byteLength"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = PropGet v5 key="resolve"
// CHECK-NEXT: v7 = Call v6, v5, v0 calleeKey="resolve" calleeName="resolve"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="constructor"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|function site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }

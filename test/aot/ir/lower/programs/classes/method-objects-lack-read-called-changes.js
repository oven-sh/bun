// RUN: lower
// OPTIONS: builtin-modules

// A method that some objects lack is read asked for and called while it changes.
const some = Symbol("some");
class Base {
  count = 0;
}
let Lazy;
function getLazy() {
  if (Lazy) return Lazy;
  Lazy = class Socket extends Base {
    plain(by) {
      this.count = (this.count + by) | 0;
      return this.count;
    }
    [some](by) {
      this.count = (this.count + by * 2) | 0;
      return this.count;
    }
  };
  return Lazy;
}
const mixed = [new (getLazy())(), new Base(), new (getLazy())(), new Base()];
function readPlain(object, i) {
  const method = object.plain;
  if (method !== undefined) return method.call(object, i);
  return -1;
}
function readSymbol(object, i) {
  const method = object[some];
  if (method !== undefined) return method.call(object, i);
  return -2;
}
function kept(object) {
  const method = object.plain;
  return method == null ? String(method) : typeof method + " " + method.name + " " + (method === getLazy().prototype.plain);
}
function run(from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum = (sum + readPlain(mixed[i & 3], i) + readSymbol(mixed[(i + 1) & 3], i)) | 0;
  return sum;
}
const steps = [
  () => {},
  () => { getLazy().prototype.plain = function other(by) { return by + 1000; }; },
  () => { mixed[0].plain = function own(by) { return by - 7; }; },
  () => { mixed[1][some] = function ownOfBase(by) { return this.count + by; }; },
  () => { delete getLazy().prototype[some]; },
  () => { Base.prototype[some] = function above(by) { return 5; }; },
  () => { Object.defineProperty(getLazy().prototype, "plain", { get() { return undefined; }, configurable: true }); },
  () => { Object.setPrototypeOf(mixed[2], { plain(by) { return 3 * by; } }); },
  () => { mixed[3].plain = null; },
];
let at = 0;
for (const step of steps) {
  step();
  let answer;
  try {
    answer = run(at, at + 400);
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(answer, mixed.map(object => object.count).join(), mixed.map(kept).join(" | "));
  at += 400;
}

// GENERATED: getLazy readSymbol Base Socket ownOfBase
// CHECK-LABEL: function {{*}}name="getLazy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Lazy"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="Lazy"
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Lazy"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="Base"
// CHECK-NEXT: v11 = ResolveHeritage v10
// CHECK-NEXT: v12 = NewClosure function=[[f_3]]
// CHECK-NEXT: v13 = NewClass v12, v10, v11 layout=[[L_4]]
// CHECK-NEXT: v14 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineMethod v13, v14 layout=[[L_4]] key="plain"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="some"
// CHECK-NEXT: v18 = ToPropertyKey v17
// CHECK-NEXT: v19 = NewClosure function=[[f_7]]
// CHECK-NEXT: SetFunctionName v19, v18
// CHECK-NEXT: DefineMethod v13, v19, v18 layout=[[L_4]] index=1
// CHECK-NEXT: v22 = FinishClass v13 layout=[[L_4]]
// CHECK-NEXT: v23 = Convert v22 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v24 = Convert v22 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v24 variable=[[g_1]]
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="Lazy"
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readSymbol"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]], v1: i32):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="some"
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = Integer integer=-2
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByTest v4, v8
// CHECK-NEXT: v10 = PropGet v9 key="call"
// CHECK-NEXT: v11 = Call v10, v9, v0, v1 calleeKey="call" calleeName="method.call"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Socket"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownOfBase"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="count"
// CHECK-NEXT: v3 = Add v2, v1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }

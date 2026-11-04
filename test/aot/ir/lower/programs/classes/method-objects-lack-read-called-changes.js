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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Lazy"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="Lazy"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="Lazy"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="Base"
// CHECK-NEXT: v12 = ResolveHeritage v11
// CHECK-NEXT: v13 = NewClosure function=[[f_4]]
// CHECK-NEXT: v14 = NewClass v13, v11, v12 layout=[[L_5]]
// CHECK-NEXT: v15 = NewClosure function=[[f_6]]
// CHECK-NEXT: DefineMethod v14, v15 layout=[[L_5]] key="plain"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="some"
// CHECK-NEXT: v19 = ToPropertyKey v18
// CHECK-NEXT: v20 = NewClosure function=[[f_8]]
// CHECK-NEXT: SetFunctionName v20, v19
// CHECK-NEXT: DefineMethod v14, v20, v19 layout=[[L_5]] index=1
// CHECK-NEXT: v23 = FinishClass v14 layout=[[L_5]]
// CHECK-NEXT: v24 = Convert v23 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v25 = Convert v23 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v25 variable=[[g_2]]
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="Lazy"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readSymbol"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]], v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="some"
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Integer integer=-2
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = PropGet v9 key="call"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v0, v1 calleeKey="call" calleeName="method.call"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Socket"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownOfBase"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=undefined|null|number|string|symbol|bigint|[[L_13]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_13]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="count"
// CHECK-NEXT: v3 = Add v2, v1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }

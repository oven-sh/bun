// RUN: lower
// OPTIONS: builtin-modules

// Plain objects are made with Object.create(typed) and then stored to. The store adds an own property unless something on the chain intercepts it: a setter or a read-only property. A typed object on the chain can only come to intercept through defineProperty, freeze or a change of its own prototype, and each of these forgets what was remembered. The store does not enter the runtime every time.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Step { op: string; weight: number; args: unknown; note?: string }
function makeStep(op: string, weight: number): Step { return { op, weight, args: undefined }; }
const steps: Step[] = [];
for (let i = 0; i < 8; i++) steps.push(makeStep("s" + i, i + 0.5));
let typedSum = 0;
for (const step of steps) typedSum += step.weight + step.op.length;
console.log(typedSum);
const loose: any[] = (function (list: any): any { return list; })(steps);
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTPutByIdAndCache") : 0;
const heirOf = function (base: any, v: any): any { const made = Object.create(base); made.value = v; made.args = v; made.op = "own"; return made; };
const show = function (o: any): string { return [Object.keys(o).join(), o.value, o.args, o.op, o.weight].join(" "); };
const attempt = function (base: any, v: any): string { try { return show(heirOf(base, v)); } catch (error: any) { return error.constructor.name; } };
console.log(attempt(loose[0], 1));
{
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += heirOf(loose[0], i).value;
  const before = entered();
  for (let i = 0; i < 2000; i++) sum += heirOf(loose[0], i).value;
  console.log(sum, entered() - before < 40, steps[0]!.op, steps[0]!.args);
}
let log: string[] = [];
console.log("before:", attempt(loose[1], 2));
Object.defineProperty(loose[1], "value", { set(this: any, v: any) { log.push("setter on the prototype " + v + " " + (this !== loose[1])); }, get() { return "got"; }, configurable: true });
console.log("a setter on the typed prototype:", attempt(loose[1], 3), log.join()); log = [];
console.log("another prototype of the same type is not touched:", attempt(loose[0], 4));
console.log("before:", attempt(loose[2], 5));
Object.defineProperty(loose[2], "value", { value: "fixed", writable: false, configurable: true });
console.log("a read-only extra property:", attempt(loose[2], 6));
console.log("before:", attempt(loose[3], 7));
Object.freeze(loose[3]);
console.log("frozen:", attempt(loose[3], 8));
const onlyValue = function (base: any, v: any): string { try { const made = Object.create(base); made.value = v; return Object.keys(made).join() + " " + made.value; } catch (error: any) { return error.constructor.name; } };
console.log("frozen, a name it does not have:", onlyValue(loose[3], 9));
console.log("before:", attempt(loose[5], 13));
Object.defineProperty(loose[5], "args", { value: "fixed args", writable: false, enumerable: true, configurable: true });
console.log("a declared field made read-only:", attempt(loose[5], 14));
console.log("before:", attempt(loose[6], 15));
try {
  Object.setPrototypeOf(loose[6], { set value(v: any) { log.push("setter above the prototype " + v); }, get value() { return "above"; } });
  console.log("a new prototype above, with a setter:", attempt(loose[6], 16), log.join());
} catch (error: any) { console.log("a new prototype above, with a setter:", error.constructor.name); }
log = [];
loose[7].value = "data on the prototype";
console.log("plain data on the prototype does not intercept:", attempt(loose[7], 17), loose[7].value);
delete loose[7].value;
console.log("and deleted:", attempt(loose[7], 18));

// GENERATED: makeStep entered heirOf set
// CHECK-LABEL: function {{*}}name="makeStep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number}
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = NewObject -, v2, v3, v4 layout=[[L_3]] fields=[2, 3, 0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="entered"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_5]]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="aotOperationCount" [isFreeName, isForTypeOf]
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="aotOperationCount" [isFreeName]
// CHECK-NEXT: v6 = String string="operationAOTPutByIdAndCache"
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="aotOperationCount"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=number site=[[w_7]]}}, {declared={type=number site=[[w_5]]}}]
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="heirOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeName="Object.create"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v1 key="value"
// CHECK-NEXT: PropSet v6, v1 key="args"
// CHECK-NEXT: v9 = String string="own"
// CHECK-NEXT: PropSet v6, v9 key="op"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="setter on the prototype "
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="loose"
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = ElemGet v10, v11
// CHECK-NEXT: v13 = StrictEq v0, v12
// CHECK-NEXT: v14 = LogicalNot v13
// CHECK-NEXT: v15 = Add v8, v14
// CHECK-NEXT: v16 = Call v4, v3, v15 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_13]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }

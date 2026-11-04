// RUN: lower
// OPTIONS: builtin-modules

// `static async constructor() {}` is a static async method named `constructor`: it may await, returns a promise and cannot be constructed.
class Adds {
  static async constructor(x) {
    const value = await x;
    return value + 1;
  }
}
class Both {
  constructor() {
    this.made = true;
  }
  static async constructor() {
    await null;
    return new Both().made;
  }
}
const results = [];
results.push(Adds.constructor(Promise.resolve(1)) instanceof Promise);
results.push(await Adds.constructor(Promise.resolve(1)));
results.push(await Both.constructor());
results.push(Object.getPrototypeOf(Adds.constructor) === Object.getPrototypeOf(async function () {}));
results.push(Adds.constructor.name, Adds.constructor.length, "prototype" in Adds.constructor);
try {
  new Adds.constructor();
} catch (error) {
  results.push(error.name);
}
console.log(results.join("\n"));

// GENERATED: constructor Both
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=function flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: PropSet v3, v4 key="made"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=function flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Both"
// CHECK-NEXT: v5 = Construct v4 calleeName="Both"
// CHECK-NEXT: v6 = PropGet v5 key="made"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }

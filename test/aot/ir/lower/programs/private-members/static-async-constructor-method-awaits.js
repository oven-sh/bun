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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=function flags=[IsExpected]} parameters=[{type=anything}] results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="made"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Both"
// CHECK-NEXT: v5 = Construct v4 calleeName="Both"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="made"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }

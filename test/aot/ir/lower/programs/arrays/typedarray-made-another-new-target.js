// RUN: lower
// OPTIONS: builtin-modules

// The constructor of a typed array class is called by native code, by super() and by `new`, for a new target that is not that constructor: a class below it, a plain function, a bound function, a proxy.
// What is made has the elements of the class that was called and the prototype of the new target. The same arrays made by from(), of() and the methods that ask Symbol.species, and arrays that get another prototype later.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name + ": " + error.message);
  }
}
function describe(one, Below, Parent) {
  let sum = 0;
  for (let k = 0; k < one.length; k++) sum += Number(one[k]);
  return [
    one.length,
    sum,
    one instanceof Below,
    one instanceof Parent,
    one.constructor === Below,
    one.constructor === Parent,
    one.constructor.name,
    Object.getPrototypeOf(one) === Below.prototype,
    Object.getPrototypeOf(one) === Parent.prototype,
    typeof one.method === "function" ? one.method() : "no method",
    Object.prototype.toString.call(one),
    ArrayBuffer.isView(one),
  ].join(" ");
}
const big = value => BigInt(value);
const plain = value => value;
for (const [Parent, element] of [
  [Uint8Array, plain],
  [Int8Array, plain],
  [Uint8ClampedArray, plain],
  [Int16Array, plain],
  [Uint16Array, plain],
  [Int32Array, plain],
  [Uint32Array, plain],
  [Float32Array, plain],
  [Float64Array, plain],
  [BigInt64Array, big],
  [BigUint64Array, big],
]) {
  class Late extends Parent {
    method() {
      return "method of " + this.constructor.name;
    }
  }
  class WithConstructor extends Parent {
    constructor(length) {
      super(length);
      this[0] = element(5);
    }
    method() {
      return "method of " + this.constructor.name;
    }
  }
  function Plain() {}
  Plain.prototype = {
    method() {
      return "method of a plain prototype";
    },
  };
  function WithoutPrototype() {}
  WithoutPrototype.prototype = 7;
  const list = [element(1), element(2), element(3)];
  console.log(Parent.name);
  tell(" Reflect.construct, itself", () => describe(Reflect.construct(Parent, [2]), Parent, Parent));
  tell(" Reflect.construct, a class below", () => describe(Reflect.construct(Parent, [2], Late), Late, Parent));
  tell(" Reflect.construct, a class below, a list", () => describe(Reflect.construct(Parent, [list], Late), Late, Parent));
  tell(" Reflect.construct, a plain function", () => describe(Reflect.construct(Parent, [2], Plain), Plain, Parent));
  tell(" Reflect.construct, no object for a prototype", () => describe(Reflect.construct(Parent, [2], WithoutPrototype), WithoutPrototype, Parent));
  tell(" Reflect.construct, a bound class", () => describe(Reflect.construct(Parent, [2], Late.bind(null)), Late, Parent));
  tell(" Reflect.construct, a proxy", () => describe(Reflect.construct(Parent, [2], new Proxy(Late, {})), Late, Parent));
  tell(" Reflect.construct, another built-in class", () => describe(Reflect.construct(Parent, [2], Array), Array, Parent));
  tell(" Reflect.construct of the class below for the parent", () => describe(Reflect.construct(Late, [2], Parent), Late, Parent));
  tell(" new, a class below", () => describe(new Late(2), Late, Parent));
  tell(" new, super()", () => describe(new WithConstructor(2), WithConstructor, Parent));
  tell(" new, a bound parent", () => describe(new (Parent.bind(null, 2))(), Parent, Parent));
  tell(" from, itself", () => describe(Parent.from(list), Parent, Parent));
  tell(" from, a class below", () => describe(Late.from(list), Late, Parent));
  tell(" from, called on a class below", () => describe(Parent.from.call(Late, list), Late, Parent));
  tell(" of, a class below", () => describe(Late.of(element(4), element(5)), Late, Parent));
  tell(" of, called on a class below", () => describe(Parent.of.call(Late, element(4)), Late, Parent));
  tell(" map of a class below", () => describe(new Late(list).map(value => value), Late, Parent));
  tell(" slice of a class below", () => describe(new Late(list).slice(1), Late, Parent));
  tell(" subarray of a class below", () => describe(new Late(list).subarray(1), Late, Parent));
  tell(" another prototype later", () => describe(Object.setPrototypeOf(Parent.from(list), Late.prototype), Late, Parent));
  tell(" another prototype later, of", () => describe(Object.setPrototypeOf(Parent.of(element(9)), Plain.prototype), Plain, Parent));
  tell(" no prototype later", () => {
    const one = Object.setPrototypeOf(Parent.from(list), null);
    return [one.length, one.constructor, String(one[1]), Object.getPrototypeOf(one)].join(" ");
  });
}

// GENERATED: big Late WithConstructor
// CHECK-LABEL: function {{*}}name="big"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|bigint flags=[IsExpected]}] results=[{type=undefined|null|bigint flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string|bigint):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=BigInt
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="BigInt"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|bigint flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="WithConstructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 captures=[{type=undefined|null|[[f_1]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|[[f_9]]|[[f_10]]|[[f_11]]|[[f_12]]|[[f_13]]|[[f_14]]|[[f_15]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]|[[f_4]]|[[f_5]]|[[f_6]]|[[f_7]]|[[f_8]]|[[f_9]]|[[f_10]]|[[f_11]]|[[f_12]]|[[f_13]]|[[f_14]]|[[f_15]], v1: function, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v1
// CHECK-NEXT: v6 = SuperConstruct v5, v2, v3 layout=[[L_16]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_16]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Integer integer=5
// CHECK-NEXT: v17 = Call v0, -, v16 calleeName="element"
// CHECK-NEXT: ElemSet v14, v15, v17
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: Jump -> next b10(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Jump -> next b10(v28)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: b11(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=DerivedConstructorResult name="WithConstructor"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b12(v32) frequency=Unlikely:
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v33
// CHECK-NEXT: }

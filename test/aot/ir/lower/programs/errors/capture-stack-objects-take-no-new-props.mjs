// RUN: lower
// OPTIONS: builtin-modules

// Error.captureStackTrace() on frozen, sealed and non-extensible arrays, objects, instances and functions.
function report(label, target) {
  let outcome;
  try {
    Error.captureStackTrace(target);
    outcome = "returned";
  } catch (error) {
    outcome = "threw " + error.constructor.name;
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, "stack");
  console.log(
    label + ":",
    outcome,
    "|",
    Reflect.ownKeys(target).map(String).join(),
    "|",
    typeof target.stack,
    "|",
    descriptor ? [descriptor.writable, descriptor.enumerable, descriptor.configurable].join() : "none",
    "|",
    Object.isFrozen(target),
    Object.isSealed(target),
    Object.isExtensible(target),
  );
}
class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
class List extends Array {}
report("frozen array of integers", Object.freeze([1]));
report("frozen array of fractions", Object.freeze([1.5, 2.5]));
report("frozen array of objects", Object.freeze([{}, "a"]));
report("frozen empty array", Object.freeze([]));
report("frozen array with a hole", Object.freeze([1, , 3]));
report("frozen long array", Object.freeze(Array.from({ length: 100 }, (_, i) => i)));
report("frozen array with a name", Object.freeze(Object.assign([1], { extra: 1 })));
report("frozen instance of a subclass of Array", Object.freeze(List.from([1, 2])));
report("sealed array", Object.seal([1]));
report("non-extensible array", Object.preventExtensions([1]));
report("array", [1]);
report("frozen literal", Object.freeze({ a: 1 }));
report("frozen instance", Object.freeze(new Point()));
report("sealed instance", Object.seal(new Point()));
report("non-extensible instance", Object.preventExtensions(new Point()));
report(
  "frozen function",
  Object.freeze(function named() {}),
);
report(
  "frozen arrow function",
  Object.freeze(() => 1),
);
report("frozen class", Object.freeze(class K {}));
report("frozen error", Object.freeze(new Error("m")));
report("frozen map", Object.freeze(new Map()));
report(
  "frozen arguments",
  Object.freeze(
    (function () {
      return arguments;
    })(1, 2),
  ),
);
report("frozen object without a prototype", Object.freeze(Object.create(null)));
report("strings of a template", (strings => strings)`c${1}d`);
report("raw strings of a template", (strings => strings.raw)`e${1}f`);

// GENERATED: Point List named
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="x"
// CHECK-NEXT: v8 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v8, v10 key="y"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = TypeTest v12 testedType=object
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="List"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }

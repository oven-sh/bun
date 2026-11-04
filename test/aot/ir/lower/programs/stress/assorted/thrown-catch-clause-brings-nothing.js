// RUN: lower
// OPTIONS: builtin-modules

// What an operation throws when it fails by itself is an error that the run time makes, and the compiler knows what such an error holds. So printing a member of what was caught needs no formatter for objects.
class Body {
  constructor(mass) {
    this.mass = mass;
  }
}
const world = [new Body(1), new Body(2)];
const text = process.argv.length > 99 ? "1" : "{";
try {
  JSON.parse(text);
} catch (error) {
  console.log(error.name, typeof error.message);
}
try {
  throw world[1];
} catch (caught) {
  console.log(caught.mass);
}
try {
  world[5].mass;
} catch (error) {
  console.log(error.name, error.mass);
}

// GENERATED: Body
// CHECK-LABEL: function {{*}}name="Body"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="mass"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }

// RUN: lower
// OPTIONS: builtin-modules

// Nothing constructs these classes or names them in an expression. They are used as types: of an object literal, of a parameter, after implements, as the base of an interface, through InstanceType and through an indexed access. The types of their members come from initializers and bodies.
class Point {
  x = 1;
  y = 2;
  label = "point";
  norm() {
    return Math.hypot(this.x, this.y);
  }
  get doubled() {
    return { x: this.x * 2, y: this.y * 2 };
  }
  static origin() {
    return new Point();
  }
}
class Named {
  name = "";
  greet() {
    return "hello " + this.name;
  }
}

const literal: Point = { x: 3, y: 4, label: "literal", norm() { return 5; }, doubled: { x: 6, y: 8 } };
function describe(point: Point) {
  return point.label + " " + point.norm().toFixed(1) + " " + point.doubled.x;
}
class Person implements Named {
  name = "Ada";
  greet() {
    return "hi " + this.name;
  }
}
interface Labeled extends Named {
  tag: string;
}
const labeled: Labeled = { name: "Bo", tag: "t", greet: () => "hey" };
const instance: InstanceType<typeof Point> = literal;
const norm: Point["norm"] = () => 9;
const made: ReturnType<typeof Point.origin> = literal;

console.log(describe(literal), new Person().greet(), labeled.greet(), labeled.tag, instance.y, norm() + 1, made.x);

// GENERATED: describe Person greet
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="label"
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="norm"
// CHECK-NEXT: v5 = Call v4, v0 calleeKey="norm" calleeName="point.norm"
// CHECK-NEXT: v6 = PropGet v5 key="toFixed"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeKey="toFixed" calleeName="toFixed"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v3, v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = PropGet v0 key="doubled"
// CHECK-NEXT: v14 = PropGet v13 key="x"
// CHECK-NEXT: v15 = Add v12, v14
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = String string="hi "
// CHECK-NEXT: v2 = PropGet v0 key="name"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="hey"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }

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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="label"
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="norm"
// CHECK-NEXT: v5 = Call v4, v0 calleeKey="norm" calleeName="point.norm"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v7 = PropGet v6 key="toFixed"
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="toFixed" calleeName="toFixed"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v3, v10
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = PropGet v0 key="doubled"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_5]] site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v16 = PropGet v15 key="x"
// CHECK-NEXT: v17 = Add v13, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_9]]} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="hi "
// CHECK-NEXT: v2 = PropGet v0 key="name"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="greet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="hey"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }

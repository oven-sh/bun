// RUN: lower
// OPTIONS: builtin-modules

// Narrowed by instanceof where has instance is a type guard.
function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class LooksSquare {
  static [Symbol.hasInstance](value: unknown): value is Square {
    return value instanceof Shape;
  }
}

class LooksLikeANumber {
  static [Symbol.hasInstance](value: unknown): value is number {
    return true;
  }
}

const shape: Shape = new Shape();
if (shape instanceof LooksSquare) {
  say("a shape: edge", shape.edge);
  say("a shape: edge doubled", shape.edge * 2);
  say("a shape: sides", shape.sides);
}

function double(v: unknown): unknown {
  if (v instanceof LooksLikeANumber) return v * 2;
  return "other";
}

function add(v: unknown): unknown {
  if (v instanceof LooksLikeANumber) return v + 1;
  return "other";
}

say("a number doubled", double(4));
say("a string doubled", double("text"));
say("a number plus one", add(4));
say("a string plus one", add("text"));
say("null plus one", add(null));
say("a shape plus one", add(new Shape()));

// GENERATED: say double Shape [Symbol.hasInstance]
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" | "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = TypeOf v1
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = String string=" | "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=String
// CHECK-NEXT: v14 = Call v13, -, v1 calleeName="String"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = Add v12, v15
// CHECK-NEXT: v17 = Call v6, v4, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="LooksLikeANumber"
// CHECK-NEXT: v3 = InstanceOf v0, v2 writtenExpression="v instanceof LooksLikeANumber"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Mul v6, v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = String string="other"
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.hasInstance]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Shape"
// CHECK-NEXT: v3 = InstanceOf v0, v2 writtenExpression="value instanceof Shape"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.hasInstance]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean site=[[w_9]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }

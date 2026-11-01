// RUN: lower
// OPTIONS: builtin-modules

// A private name in the heritage clause of a class is the enclosing class's, even if the class declares the same name.
class Outer {
  #name = "outer";
  static read(object) {
    let seen;
    class Inner extends ((seen = object.#name), Object) {
      #name = "inner";
      static read(other) { return other.#name; }
    }
    return seen + " " + Inner.read(new Inner());
  }
  static has(object) {
    let seen;
    class Inner extends ((seen = #name in object), Object) {
      #name = "inner";
      static has(other) { return #name in other; }
    }
    return seen + " " + Inner.has(object);
  }
}
console.log(Outer.read(new Outer()));
console.log(Outer.has(new Outer()));

// GENERATED: Outer read Inner
// CHECK-LABEL: function {{*}}name="Outer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = PrivateGet v0, v2 layout=[[L_1]] field=1
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Object) flags=[IsExpected]}
// CHECK-NEXT: v6 = ResolveHeritage v5
// CHECK-NEXT: v7 = NewClassToken layout=[[L_5]]
// CHECK-NEXT: v8 = NewClosure v7 function=[[f_6]]
// CHECK-NEXT: v9 = NewClass v8, v5, v6 layout=[[L_5]]
// CHECK-NEXT: v10 = NewClosure v7 function=[[f_7]]
// CHECK-NEXT: DefineMethod v9, v10 layout=[[L_5]] side=Static key="read"
// CHECK-NEXT: v12 = FinishClass v9 layout=[[L_5]]
// CHECK-NEXT: v13 = Convert v12 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = Convert v12 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = String string=" "
// CHECK-NEXT: v16 = Add v3, v15
// CHECK-NEXT: v17 = PropGet v14 key="read"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Construct v14 calleeName="Inner"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v18, v14, v20 calleeKey="read" calleeName="Inner.read"
// CHECK-NEXT: v22 = Add v16, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: function, v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetSuperBase v1
// CHECK-NEXT: v5 = SuperConstructList v4, v2, v3 layout=[[L_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = CallDirect v0, v6 function=[[f_9]]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateGet v1, v0 layout=[[L_5]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: function, v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetSuperBase v1
// CHECK-NEXT: v5 = SuperConstructList v4, v2, v3 layout=[[L_10]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = CallDirect v0, v6 function=[[f_11]]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }

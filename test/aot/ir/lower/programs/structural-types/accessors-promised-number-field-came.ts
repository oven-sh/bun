// RUN: lower
// OPTIONS: builtin-modules

// Accessors were promised a number field came and the base stores a string.
function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

abstract class Promised {
  abstract get size(): number;
  abstract set size(value: number | string);
  fill(): void {
    this.size = "text";
  }
}

class AField extends Promised {
  size = 5;
  other = 6;
  twice(): number {
    return this.size * 2;
  }
}

const o = new AField();
say("before", o.size);
say("before, twice", o.twice());
o.fill();
say("after", o.size);
say("after, plus one", o.size + 1);
say("after, doubled", o.size * 2);
say("after, twice", o.twice());
say("the other field", o.other);

// GENERATED: say Promised fill AField twice
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
// CHECK-LABEL: function {{*}}name="Promised"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fill"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_5]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="text"
// CHECK-NEXT: PropSet v0, v1 key="size"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="AField"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_9]]} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="size"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }

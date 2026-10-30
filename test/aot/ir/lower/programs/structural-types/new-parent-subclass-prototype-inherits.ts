// RUN: lower
// OPTIONS: builtin-modules

// The only new parent of a subclass prototype is inherits of node util.
import { inherits } from "node:util";

class Walker {
  legs = 2;
  move(): string {
    return "walks on " + this.legs;
  }
  get speed(): number {
    return this.legs * 3;
  }
}

class Swimmer {
  legs = 0;
  move(): string {
    return "swims with " + this.legs;
  }
  get speed(): number {
    return 50;
  }
}

class Person extends Walker {
  name = "person";
  above(): string {
    return super.move();
  }
}

function moveOf(p: Person): string {
  return p.move() + " at " + p.speed;
}

function asWalker(w: Walker): string {
  return w.move() + " at " + w.speed;
}

const p = new Person();

function report(label: string): void {
  console.log(label + ": " + p.move() + " | " + moveOf(p) + " | " + asWalker(p) + " | " + p.above() + " | " + moveOf(new Person()) + " | " + asWalker(new Walker()) + " | " + (p instanceof Walker) + " " + (p instanceof Swimmer));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += moveOf(p).length + asWalker(p).length + p.above().length + (p instanceof Walker ? 1 : 0);
console.log("2000 honest rounds: " + warm);
report("before");
inherits(Person, Swimmer);
report("under the swimmer");
inherits(Person, Walker);
report("back under the walker");
inherits(Person, Swimmer);
report("under the swimmer again");

export {};

// GENERATED: moveOf Walker speed Person above
// CHECK-LABEL: function {{*}}name="moveOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="move"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="move" calleeName="p.move"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = String string=" at "
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = PropGet v0 key="speed"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Walker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="speed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_9]]} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="legs"
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="speed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=50
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_13]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="above"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_14]]} results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="move"
// CHECK-NEXT: v4 = Call v3, v0 calleeName="super.move"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }

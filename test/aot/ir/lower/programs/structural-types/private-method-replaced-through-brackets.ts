// RUN: lower
// OPTIONS: builtin-modules

// A private method is replaced through brackets.
class Vault {
  private code = 7;
  private check(guess: number): boolean {
    return guess === this.code;
  }
  protected hint(): string {
    return "starts with " + this.code;
  }
  private static attempts(): number {
    return 3;
  }
  private get masked(): string {
    return "*" + this.code;
  }
  open(guess: number): string {
    return (this.check(guess) ? "open" : "shut") + ", " + this.hint() + ", " + Vault.attempts() + " attempts, " + this.masked;
  }
  weaken(): void {
    this.check = () => true;
  }
}

class Friendly extends Vault {
  explain(): string {
    return this.hint();
  }
  soften(): void {
    this.hint = () => "an own hint";
  }
}

function openOf(v: Vault, guess: number): string {
  return v.open(guess);
}

const v = new Vault();
const other = new Vault();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += openOf(v, i % 10).length;
console.log("2000 honest: " + warm);
console.log("before: " + openOf(v, 1) + " | " + openOf(v, 7));

v["check"] = guess => guess === 1;
console.log("the private method covered from outside: " + openOf(v, 1) + " | " + openOf(v, 7) + " | the other " + openOf(other, 1));

Reflect.deleteProperty(v, "check");
console.log("uncovered: " + openOf(v, 1));

v.weaken();
console.log("covered by a method of the class: " + openOf(v, 1) + " | keys " + Object.keys(v).join());
Reflect.deleteProperty(v, "check");

const check = Vault.prototype["check"];
Vault.prototype["check"] = function (guess) {
  return guess === this["code"] + 1;
};
console.log("replaced on the prototype: " + openOf(v, 7) + " | " + openOf(other, 8));
Vault.prototype["check"] = check;

v["code"] = 1;
console.log("the private field stored to: " + openOf(v, 1) + " | " + openOf(other, 1));

const attempts = Vault["attempts"];
Vault["attempts"] = () => 99;
console.log("the private static method replaced: " + openOf(v, 1));
Vault["attempts"] = attempts;

Object.defineProperty(v, "masked", { value: "not masked", configurable: true });
console.log("the private getter covered: " + openOf(v, 1) + " | " + openOf(other, 7));
Reflect.deleteProperty(v, "masked");

const f = new Friendly();
console.log("a subclass: " + f.explain() + " | " + openOf(f, 7));
f.soften();
console.log("the protected method covered by the subclass: " + f.explain() + " | " + openOf(f, 7));
console.log("restored: " + openOf(v, 1) + " | " + openOf(new Vault(), 7));

export {};

// GENERATED: Vault check attempts masked weaken Friendly explain
// CHECK-LABEL: function {{*}}name="Vault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_2]] site=[[w_4]]} parameters=[{type=number site=[[w_5]]}] results=[{type=boolean site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="code"
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_6]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempts"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_8]]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=3
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="masked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]] site=[[w_10]]} results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="*"
// CHECK-NEXT: v2 = PropGet v0 key="code"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="weaken"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]] site=[[w_12]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_13]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_7]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v2 key="check"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Friendly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_16]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="explain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_16]] site=[[w_17]]} results=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="hint"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_19]] site=[[w_20]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="hint" calleeName="this.hint"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }

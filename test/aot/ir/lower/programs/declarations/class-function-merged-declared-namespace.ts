// RUN: lower
// OPTIONS: builtin-modules

// A class or a function merged with a `declare namespace` that declares values: statics, `prototype` and added properties are ordinary properties.
class Completions {
  name = "completions";
}
class Client {
  static DEFAULT_TIMEOUT = 600;
  timeout: number = Client.DEFAULT_TIMEOUT;
  send(): string {
    return "sent";
  }
  isOverridden(): boolean {
    return this.send !== Client.prototype.send;
  }
}
Client.Completions = Completions;
declare namespace Client {
  export { Completions as Completions };
}
class Patched extends Client {
  send(): string {
    return "patched";
  }
}
function marked(text: string): string {
  return text.toUpperCase();
}
declare namespace marked {
  let once: typeof marked;
}
marked.once = marked;
marked.twice = (text: string) => marked(text) + marked.once(text);
console.log(new Client().timeout, new Client.Completions().name, new Client().isOverridden(), new Patched().isOverridden());
console.log(marked.once("a"), marked.twice("b"), Object.keys(marked).join());
Client.DEFAULT_TIMEOUT = 5;
console.log(new Client().timeout, Object.keys(Client).join());
export {};

// GENERATED: marked Completions send isOverridden Patched
// CHECK-LABEL: function {{*}}name="marked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="toUpperCase"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="toUpperCase" calleeName="text.toUpperCase"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Completions"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="send"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="sent"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isOverridden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_11]]} results=[{type=boolean site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="send"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Client"
// CHECK-NEXT: v4 = PropGet v3 key="prototype"
// CHECK-NEXT: v5 = PropGet v4 key="send"
// CHECK-NEXT: v6 = StrictEq v1, v5
// CHECK-NEXT: v7 = LogicalNot v6
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Patched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="send"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="patched"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }

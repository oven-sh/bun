// RUN: lower
// OPTIONS: builtin-modules

// TypeScript lets `box["name"]` read a private or protected member, and reports no function that is tested and never called. A build goes by that.
class Box {
  private hidden = 3;
  protected kept = 4;
  private measure() {
    return this.hidden + this.kept;
  }
}
const box = new Box();
const table: { [key: string]: number } = { a: 1 };
const tools = {
  run() {
    return 1;
  },
};
console.log(box["hidden"], box["kept"], box[`hidden`], box?.["kept"], box["measure"]());
console.log(table["a"], table.a);
if (tools["run"]) console.log("tested");

// GENERATED: Box measure run
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="measure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_3]]} results=[{type=number site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="hidden"
// CHECK-NEXT: v2 = PropGet v0 key="kept"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_5]]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }

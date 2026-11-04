// RUN: lower
// OPTIONS: builtin-modules

// The callback and the receiver of a built-in change inside that callback.
function main() {
  let callback = (m) => { callback = (n) => ({ toString() { return "[" + n + "]"; } }); return "1"; };
  let text = "aaa";
  for (let i = 0; i < 3; i++) text = text.replace("a", callback);
  console.log(text);
  let receiver = "xyz";
  const lengths = [];
  function swap(m) { receiver = { toString() { return "object text"; } }; return m; }
  for (let i = 0; i < 2; i++) lengths.push(String.prototype.replace.call(receiver, "x", swap).length);
  console.log(lengths.join());
}
main();

// GENERATED: swap callback toString
// CHECK-LABEL: function {{*}}name="swap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = CheckInitialized v2 name="receiver"
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_1]] field=1
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="callback"
// CHECK-NEXT: v4 = NewClosure function=[[f_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = String string="1"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="object text"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=anything variableName="n"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="["
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = String string="]"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }

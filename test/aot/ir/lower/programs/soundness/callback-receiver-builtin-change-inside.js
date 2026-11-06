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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = CheckInitialized v2 name="receiver"
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v6, v5 key="toString"
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v9 layout=[[L_1]] field=1
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="callback"
// CHECK-NEXT: v4 = NewClosure function=[[f_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = String string="1"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="object text"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_10]]|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v3, v2 key="toString"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="["
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = String string="]"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }

// RUN: lower
// OPTIONS: builtin-modules

// `@jsx exports.h`, where `exports` is the first parameter of the callback that `__commonJS(..)` takes.
/** @jsxRuntime classic */
/** @jsx exports.h */
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_lib = __commonJS((exports, module) => {
  exports.h = tag => "h:" + tag;
  exports.v = <div />;
});
console.log(require_lib().v);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="__commonJS"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v3 calleeName="require_lib"
// CHECK-NEXT: v10 = PropGet v9 key="v"
// CHECK-NEXT: v11 = Call v8, v6, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|[[L_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_3]]):
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_6]], v1: anything):
// CHECK-NEXT: v2 = NewClosure function=[[f_7]]
// CHECK-NEXT: PropSet v0, v2 key="h"
// CHECK-NEXT: v4 = PropGet v0 key="h"
// CHECK-NEXT: v5 = String string="div"
// CHECK-NEXT: v6 = Null
// CHECK-NEXT: v7 = Call v4, v0, v5, v6 calleeKey="h" calleeName="h"
// CHECK-NEXT: PropSet v0, v7 key="v"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=undefined|null|function flags=[IsExpected] variableName="cb"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: undefined|null|function):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Data data=[[d_8]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v6 layout=[[L_4]]
// CHECK-NEXT: v8 = PropGet v5 key="exports"
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v10 = Call v1, -, v8, v9 calleeName="cb"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v12 = PropGet v11 key="exports"
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="h:"
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

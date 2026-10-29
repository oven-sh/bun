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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="__commonJS"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v5 calleeName="require_lib"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="v"
// CHECK-NEXT: v14 = Call v10, v8, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|[[L_6]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_4]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_9]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewClosure function=[[f_11]]
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_7]] flags=[IsFromCompiler]}, {type=undefined|null|function flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_7]], v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v6 = Data data=[[d_12]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_7]]
// CHECK-NEXT: v9 = PropGet v6 key="exports"
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v11 = Call v1, -, v9, v10 calleeName="cb"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v13 = PropGet v12 key="exports"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="h:"
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

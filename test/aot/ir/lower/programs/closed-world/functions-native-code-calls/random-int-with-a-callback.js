// RUN: lower
// OPTIONS: builtin-modules

// crypto.randomInt with a callback answers on the next tick.
import { randomInt } from "node:crypto";
randomInt(1, 2, (error, value) => console.log("callback: " + error + " " + value));
console.log("before the callback");

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="randomInt"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(NodeCryptoRandomInt) flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = NewClosure function=[[f_2]]
// CHECK-NEXT: v6 = Call v2, -, v3, v4, v5 calleeName="randomInt"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="before the callback"
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|Error flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|Error, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="callback: "
// CHECK-NEXT: v8 = Add v7, v0
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Add v10, v1
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

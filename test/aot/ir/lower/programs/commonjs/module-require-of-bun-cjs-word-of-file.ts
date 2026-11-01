// RUN: lower
// OPTIONS: builtin-modules

// Nothing else in the file says CommonJS, and the transpiler reads neither `module` nor `require` here.
console.log(module.require("bun").color("red", "hex"));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = RequireModule module=[[m_1]] referrer=[[m_0]] specifier="bun"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="color"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(BunColor) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="red"
// CHECK-NEXT: v10 = String string="hex"
// CHECK-NEXT: v11 = Call v8, v6, v9, v10 calleeKey="color" calleeName="color"
// CHECK-NEXT: v12 = Call v4, v2, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }

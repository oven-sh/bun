// RUN: lower
// OPTIONS: builtin-modules

// The transpiler leaves `module?.require` as it is, so `module` is read, and the file is CommonJS for it.
console.log(module?.require("node:path").sep, module?.["require"]("node:path").sep, module.require?.("node:path").sep);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="sep"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="sep"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="sep"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = Call v7, v5, v10, v13, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }

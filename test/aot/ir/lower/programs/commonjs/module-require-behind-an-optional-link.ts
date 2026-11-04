// RUN: lower
// OPTIONS: builtin-modules

// The transpiler leaves `module?.require` as it is, so `module` is read, and the file is CommonJS for it.
console.log(module?.require("node:path").sep, module?.["require"]("node:path").sep, module.require?.("node:path").sep);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v9 = PropGet v8 key="sep"
// CHECK-NEXT: v10 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v11 = PropGet v10 key="sep"
// CHECK-NEXT: v12 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v13 = PropGet v12 key="sep"
// CHECK-NEXT: v14 = Call v7, v5, v9, v11, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }

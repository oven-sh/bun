// RUN: lower
// OPTIONS: builtin-modules

// One name is imported and require under another name is called in a function.
import { basename } from "node:path";
const load = require;
function get(name) { return load(name); }
console.log(basename("/a/b.txt"), get("node:" + "path").join("a", "b"), get("node:pa" + "th").extname("x.js"));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v3 = PropGet v2 key="require"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_2]]
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="basename"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(NodePathBasename) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="/a/b.txt"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="basename"
// CHECK-NEXT: v16 = String string="node:path"
// CHECK-NEXT: v17 = Call v1, -, v16 calleeName="get"
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = String string="a"
// CHECK-NEXT: v20 = String string="b"
// CHECK-NEXT: v21 = Call v18, v17, v19, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: v22 = String string="node:path"
// CHECK-NEXT: v23 = Call v1, -, v22 calleeName="get"
// CHECK-NEXT: v24 = PropGet v23 key="extname"
// CHECK-NEXT: v25 = String string="x.js"
// CHECK-NEXT: v26 = Call v24, v23, v25 calleeKey="extname" calleeName="extname"
// CHECK-NEXT: v27 = Call v10, v8, v15, v21, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: SwitchString v0 strings=["node:path"] -> case b1(), otherwise b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = RequireModule module=[[m_4]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: Jump -> next b3(v1)
// CHECK-NEXT: b2():
// CHECK-NEXT: v2 = RequireDynamic v0 referrer=[[m_0]] [allNamesAreKnown]
// CHECK-NEXT: Jump -> next b3(v2)
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: Return v3
// CHECK-NEXT: }

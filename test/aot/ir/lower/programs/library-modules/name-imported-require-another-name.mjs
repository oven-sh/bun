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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v3 = PropGet v2 key="require"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_3]]
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="basename"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(NodePathBasename) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="/a/b.txt"
// CHECK-NEXT: v16 = Call v14, -, v15 calleeName="basename"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="node:path"
// CHECK-NEXT: v19 = Call v1, -, v18 calleeName="get"
// CHECK-NEXT: v20 = PropGet v19 key="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="a"
// CHECK-NEXT: v23 = String string="b"
// CHECK-NEXT: v24 = Call v21, v19, v22, v23 calleeKey="join" calleeName="join"
// CHECK-NEXT: v25 = String string="node:path"
// CHECK-NEXT: v26 = Call v1, -, v25 calleeName="get"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="extname"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="x.js"
// CHECK-NEXT: v31 = Call v29, v27, v30 calleeKey="extname" calleeName="extname"
// CHECK-NEXT: v32 = Call v11, v9, v17, v24, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["node:path"] -> case b2(), otherwise b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v1 = RequireModule module=[[m_6]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: Jump -> next b4(v1)
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = RequireDynamic v0 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b4(v2)
// CHECK-NEXT: b4(v3):
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ModuleRequire]

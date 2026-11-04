// RUN: lower
// OPTIONS: builtin-modules

// The host makes the namespace object of one of its modules by reading every export, which names none. The read that names an export through the namespace object does.

import * as path from "node:path";
import * as util from "node:util";
import * as moduleOfNode from "node:module";
import * as os from "node:os";

console.log(path.join("a", "b"), util.format("%s-%d", "x", 1), moduleOfNode.isBuiltin("node:os"), typeof os.cpus().length);
const hand = namespace => namespace;
console.log(hand(util).inspect({ a: [1, 2] }), hand(path).posix.basename("/a/b.js"));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(NodePathJoin) flags=[IsExpected]}
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v9 = String string="a"
// CHECK-NEXT: v10 = String string="b"
// CHECK-NEXT: v11 = Call v7, v8, v9, v10 calleeName="path.join"
// CHECK-NEXT: v12 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v13 = PropGet v12 key="format"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(NodeUtilFormat) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="%s-%d"
// CHECK-NEXT: v16 = String string="x"
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = Call v14, v12, v15, v16, v17 calleeKey="format" calleeName="util.format"
// CHECK-NEXT: v19 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v20 = PropGet v19 key="isBuiltin"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(NodeModuleIsBuiltin) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="node:os"
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="isBuiltin" calleeName="moduleOfNode.isBuiltin"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="cpus"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(NodeOsCpus) flags=[IsExpected]}
// CHECK-NEXT: v27 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v28 = Call v26, v27 calleeName="os.cpus"
// CHECK-NEXT: v29 = PropGet v28 key="length"
// CHECK-NEXT: v30 = TypeOf v29
// CHECK-NEXT: v31 = Call v4, v2, v11, v18, v23, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = NewClosure function=[[f_7]]
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v39 = Call v32, -, v38 calleeName="hand"
// CHECK-NEXT: v40 = PropGet v39 key="inspect"
// CHECK-NEXT: v41 = Data data=[[d_8]]
// CHECK-NEXT: v42 = Call v40, v39, v41 calleeKey="inspect" calleeName="inspect"
// CHECK-NEXT: v43 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v44 = Call v32, -, v43 calleeName="hand"
// CHECK-NEXT: v45 = PropGet v44 key="posix"
// CHECK-NEXT: v46 = PropGet v45 key="basename"
// CHECK-NEXT: v47 = String string="/a/b.js"
// CHECK-NEXT: v48 = Call v46, v45, v47 calleeKey="basename" calleeName="basename"
// CHECK-NEXT: v49 = Call v37, v35, v42, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hand"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }

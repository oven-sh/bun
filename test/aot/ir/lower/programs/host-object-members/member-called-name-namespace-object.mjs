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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(NodePathJoin) flags=[IsExpected]}
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="a"
// CHECK-NEXT: v11 = String string="b"
// CHECK-NEXT: v12 = Call v7, v9, v10, v11 calleeName="path.join"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="format"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(NodeUtilFormat) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="%s-%d"
// CHECK-NEXT: v19 = String string="x"
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Call v17, v15, v18, v19, v20 calleeKey="format" calleeName="util.format"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v23 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="isBuiltin"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(NodeModuleIsBuiltin) flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="node:os"
// CHECK-NEXT: v28 = Call v26, v24, v27 calleeKey="isBuiltin" calleeName="moduleOfNode.isBuiltin"
// CHECK-NEXT: v29 = Convert v28 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="cpus"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(NodeOsCpus) flags=[IsExpected]}
// CHECK-NEXT: v33 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v35 = Call v32, v34 calleeName="os.cpus"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Array<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="length"
// CHECK-NEXT: v38 = Convert v37 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v39 = TypeOf v38
// CHECK-NEXT: v40 = Call v4, v2, v13, v22, v29, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v41 = NewClosure function=[[f_8]]
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v43 = Builtin builtin=GlobalThis
// CHECK-NEXT: v44 = PropGet v43 key="console" [isFreeName]
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="log"
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v48 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v50 = Call v42, -, v49 calleeName="hand"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="inspect"
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v54 = Data data=[[d_10]]
// CHECK-NEXT: v55 = Call v53, v51, v54 calleeKey="inspect" calleeName="inspect"
// CHECK-NEXT: v56 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v58 = Call v42, -, v57 calleeName="hand"
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v60 = PropGet v59 key="posix"
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v62 = PropGet v61 key="basename"
// CHECK-NEXT: v63 = Convert v62 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v64 = String string="/a/b.js"
// CHECK-NEXT: v65 = Call v63, v61, v64 calleeKey="basename" calleeName="basename"
// CHECK-NEXT: v66 = Call v47, v45, v55, v65 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v67 = Undefined
// CHECK-NEXT: Return v67
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hand"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|object flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

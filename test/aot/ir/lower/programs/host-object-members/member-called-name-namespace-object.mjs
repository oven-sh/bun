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
// CHECK-NEXT: v26 = String string="node:os"
// CHECK-NEXT: v27 = Call v25, v24, v26 calleeKey="isBuiltin" calleeName="moduleOfNode.isBuiltin"
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="cpus"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(NodeOsCpus) flags=[IsExpected]}
// CHECK-NEXT: v32 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v31, v33 calleeName="os.cpus"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|Array<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="length"
// CHECK-NEXT: v37 = Convert v36 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v38 = TypeOf v37
// CHECK-NEXT: v39 = Call v4, v2, v13, v22, v28, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = NewClosure function=[[f_8]]
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v49 = Call v41, -, v48 calleeName="hand"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="inspect"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v53 = Data data=[[d_10]]
// CHECK-NEXT: v54 = Call v52, v50, v53 calleeKey="inspect" calleeName="inspect"
// CHECK-NEXT: v55 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v57 = Call v41, -, v56 calleeName="hand"
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v59 = PropGet v58 key="posix"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v61 = PropGet v60 key="basename"
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v63 = String string="/a/b.js"
// CHECK-NEXT: v64 = Call v62, v60, v63 calleeKey="basename" calleeName="basename"
// CHECK-NEXT: v65 = Call v46, v44, v54, v64 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v66 = Undefined
// CHECK-NEXT: Return v66
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

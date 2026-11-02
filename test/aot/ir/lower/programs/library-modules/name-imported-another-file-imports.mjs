// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// .. through another file of the program that imports the namespace.
import { createServer } from "node:http";
import { http } from "./whole/namespace.mjs";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(http);
console.log(typeof createServer);

// FILE: whole/namespace.mjs
import * as http from "node:http";
export { http };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="show"
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="createServer"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(NodeHttpCreateServer) flags=[IsExpected]}
// CHECK-NEXT: v13 = TypeOf v12
// CHECK-NEXT: v14 = Call v9, v7, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v0 key="request"
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = PropGet v0 key="get"
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: v10 = PropGet v0 key="METHODS"
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = Integer integer=10
// CHECK-NEXT: v14 = Greater v12, v13
// CHECK-NEXT: v15 = PropGet v0 key="Agent"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v17 = Data data=[[d_6]]
// CHECK-NEXT: v18 = Construct v16, -, v17 calleeName="m.Agent"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="keepAlive"
// CHECK-NEXT: v21 = PropGet v0 key="ClientRequest"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="http://127.0.0.1:1/"
// CHECK-NEXT: v24 = Construct v22, -, v23 calleeName="m.ClientRequest"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="on"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v28 = String string="error"
// CHECK-NEXT: v29 = NewClosure function=[[f_9]]
// CHECK-NEXT: v30 = Call v27, v25, v28, v29 calleeKey="on" calleeName="on"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="abort"
// CHECK-NEXT: v33 = TypeOf v32
// CHECK-NEXT: v34 = Call v5, v3, v7, v9, v14, v20, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v34
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="show"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="createServer"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(NodeHttpCreateServer) flags=[IsExpected]}
// CHECK-NEXT: v11 = TypeOf v10
// CHECK-NEXT: v12 = Call v7, v5, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
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
// CHECK-NEXT: v12 = Integer integer=10
// CHECK-NEXT: v13 = Greater v11, v12
// CHECK-NEXT: v14 = PropGet v0 key="Agent"
// CHECK-NEXT: v15 = Data data=[[d_5]]
// CHECK-NEXT: v16 = Construct v14, -, v15 calleeName="m.Agent"
// CHECK-NEXT: v17 = PropGet v16 key="keepAlive"
// CHECK-NEXT: v18 = PropGet v0 key="ClientRequest"
// CHECK-NEXT: v19 = String string="http://127.0.0.1:1/"
// CHECK-NEXT: v20 = Construct v18, -, v19 calleeName="m.ClientRequest"
// CHECK-NEXT: v21 = PropGet v20 key="on"
// CHECK-NEXT: v22 = String string="error"
// CHECK-NEXT: v23 = NewClosure function=[[f_6]]
// CHECK-NEXT: v24 = Call v21, v20, v22, v23 calleeKey="on" calleeName="on"
// CHECK-NEXT: v25 = PropGet v24 key="abort"
// CHECK-NEXT: v26 = TypeOf v25
// CHECK-NEXT: v27 = Call v5, v3, v7, v9, v13, v17, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v27
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }

// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// A class that a module exports only as a type is not a member of the module's namespace object.
import * as direct from "./sockets";
import * as through from "./index";
console.log(Object.keys(direct).sort().join(","));
console.log(Object.keys(through).sort().join(","));
console.log(Object.keys(await import("./sockets")).sort().join(","));
console.log("SocketMessage" in direct, (through as any).Third, new direct.Kept().text);

// FILE: index.ts
export { type SocketMessage, type SocketPeer, defineSocket } from "./sockets";
export * from "./sockets";

// FILE: messages.ts
export class Message { text = "message" }
export interface Peer { id: string }
export function connect(): number { return 1; }

// FILE: sockets.ts
export type { Message as SocketMessage, Peer as SocketPeer } from "./messages";
export { type Message as Second, connect, Message as Kept } from "./messages";
import type { Message } from "./messages";
import { type Message as Fourth } from "./messages";
export { Message as Third, Fourth };
export function defineSocket(): number { return 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeName="Object.keys"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = PropGet v9 key="sort"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = String string=","
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Call v4, v2, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = Builtin builtin=Object
// CHECK-NEXT: v24 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v25 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v26 = Call v24, v23, v25 calleeName="Object.keys"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v28 = PropGet v27 key="sort"
// CHECK-NEXT: v29 = Call v28, v27 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v31 = PropGet v30 key="join"
// CHECK-NEXT: v32 = String string=","
// CHECK-NEXT: v33 = Call v31, v30, v32 calleeKey="join" calleeName="join"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = Call v22, v20, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = Builtin builtin=Object
// CHECK-NEXT: v42 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v43 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v44 = Await v43
// CHECK-NEXT: v45 = Call v42, v41, v44 calleeName="Object.keys"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v47 = PropGet v46 key="sort"
// CHECK-NEXT: v48 = Call v47, v46 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v50 = PropGet v49 key="join"
// CHECK-NEXT: v51 = String string=","
// CHECK-NEXT: v52 = Call v50, v49, v51 calleeKey="join" calleeName="join"
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v54 = Call v40, v38, v53 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v55 = Builtin builtin=GlobalThis
// CHECK-NEXT: v56 = PropGet v55 key="console" [isFreeName]
// CHECK-NEXT: v57 = Convert v56 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v58 = PropGet v57 key="log"
// CHECK-NEXT: v59 = Convert v58 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v60 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v61 = PropHas v60 key="SocketMessage"
// CHECK-NEXT: v62 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v63 = PropGet v62 key="Third"
// CHECK-NEXT: v64 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v65 = CheckInitialized v64 name="Kept"
// CHECK-NEXT: v66 = Construct v65 calleeName="direct.Kept"
// CHECK-NEXT: v67 = Convert v66 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v68 = PropGet v67 key="text"
// CHECK-NEXT: v69 = Call v59, v57, v61, v63, v68 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v70 = Undefined
// CHECK-NEXT: Return v70
// CHECK-NEXT: }

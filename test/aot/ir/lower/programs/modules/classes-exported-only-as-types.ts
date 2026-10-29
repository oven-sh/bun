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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v9 = Call v6, v5, v8 calleeName="Object.keys"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = PropGet v10 key="sort"
// CHECK-NEXT: v12 = Call v11, v10 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = String string=","
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = Call v4, v2, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = Builtin builtin=Object
// CHECK-NEXT: v25 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v26 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v28 = Call v25, v24, v27 calleeName="Object.keys"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = PropGet v29 key="sort"
// CHECK-NEXT: v31 = Call v30, v29 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v33 = PropGet v32 key="join"
// CHECK-NEXT: v34 = String string=","
// CHECK-NEXT: v35 = Call v33, v32, v34 calleeKey="join" calleeName="join"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Call v23, v21, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="console" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="log"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v43 = Builtin builtin=Object
// CHECK-NEXT: v44 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v45 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v46 = Await v45
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v48 = Call v44, v43, v47 calleeName="Object.keys"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v50 = PropGet v49 key="sort"
// CHECK-NEXT: v51 = Call v50, v49 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v53 = PropGet v52 key="join"
// CHECK-NEXT: v54 = String string=","
// CHECK-NEXT: v55 = Call v53, v52, v54 calleeKey="join" calleeName="join"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v57 = Call v42, v40, v56 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v58 = Builtin builtin=GlobalThis
// CHECK-NEXT: v59 = PropGet v58 key="console" [isFreeName]
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v61 = PropGet v60 key="log"
// CHECK-NEXT: v62 = Convert v61 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v63 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v64 = Convert v63 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v65 = PropHas v64 key="SocketMessage"
// CHECK-NEXT: v66 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v67 = Convert v66 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v68 = Convert v67 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v69 = PropGet v68 key="Third"
// CHECK-NEXT: v70 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v71 = CheckInitialized v70 name="Kept"
// CHECK-NEXT: v72 = Convert v71 declared={type=undefined|null|[[f_9]] site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v73 = Construct v72 calleeName="direct.Kept"
// CHECK-NEXT: v74 = Convert v73 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v75 = PropGet v74 key="text"
// CHECK-NEXT: v76 = Call v62, v60, v65, v69, v75 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v77 = Undefined
// CHECK-NEXT: Return v77
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.mjs
// A CommonJS file with `__esModule` defines `default` with a getter that is not enumerable. No loop over its exports sees the getter, so the default import
// is the whole exports. Whoever requires the file runs the getter.
import whole, { other } from "./lib.cjs";
import * as all from "./lib.cjs";
import overNoFlag from "./over-a-file-without-the-flag.cjs";
import { read } from "./reader.cjs";

console.log(JSON.stringify(whole), other, Object.keys(all), JSON.stringify(all.default), JSON.stringify(overNoFlag), read());

// FILE: inner.cjs
exports.default = "text of a file without the flag";

// FILE: lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./marked.cjs");
Object.defineProperty(exports, "default", { get: function () { return below_1.default; } });
exports.other = 2;

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = "text";

// FILE: over-a-file-without-the-flag.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "default", { get: function () { return below_1.default; } });

// FILE: reader.cjs
var lib = require("./lib.cjs");
var second = require("./over-a-file-without-the-flag.cjs");
exports.read = function () {
  return [lib.default, second.default];
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

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
// CHECK-NEXT: v5 = Builtin builtin=JSON
// CHECK-NEXT: v6 = PropGet v5 key="stringify"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="whole"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"text" flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v7, v5, v10 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="other"
// CHECK-NEXT: v15 = Convert v14 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=Object
// CHECK-NEXT: v17 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v18 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v17, v16, v19 calleeName="Object.keys"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v22 = Builtin builtin=JSON
// CHECK-NEXT: v23 = PropGet v22 key="stringify"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v25 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="default"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|"text" flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v24, v22, v28 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v31 = Builtin builtin=JSON
// CHECK-NEXT: v32 = PropGet v31 key="stringify"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="overNoFlag"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|"text of a file without the flag" flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v33, v31, v36 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40 calleeName="read"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|Array<undefined|null|"text"|"text of a file without the flag"> flags=[IsExpected]}
// CHECK-NEXT: v43 = Call v4, v2, v12, v15, v21, v30, v38, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]

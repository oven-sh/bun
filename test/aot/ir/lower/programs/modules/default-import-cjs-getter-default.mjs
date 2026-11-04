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
// CHECK-NEXT: v10 = Call v7, v5, v9 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="other"
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v15 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeName="Object.keys"
// CHECK-NEXT: v17 = Builtin builtin=JSON
// CHECK-NEXT: v18 = PropGet v17 key="stringify"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v20 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v21 = PropGet v20 key="default"
// CHECK-NEXT: v22 = Call v19, v17, v21 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v23 = Builtin builtin=JSON
// CHECK-NEXT: v24 = PropGet v23 key="stringify"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="overNoFlag"
// CHECK-NEXT: v28 = Call v25, v23, v27 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v30 = Call v29 calleeName="read"
// CHECK-NEXT: v31 = Call v4, v2, v10, v12, v16, v22, v28, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }

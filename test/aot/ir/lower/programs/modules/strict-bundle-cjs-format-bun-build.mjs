// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A strict bundle in the commonjs format of bun build returns early and names a source map.
import m from "./pkg/index.js";
console.log(JSON.stringify(m));

// FILE: pkg/index.js
// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {"use strict";
var path = require("path");
exports.strict = (function () { return this === undefined; })();
exports.file = path.basename(__filename);
exports.early = 1;
if (exports.early) return;
exports.late = 2;
})

//# sourceMappingURL=index.js.map

// FILE: pkg/package.json
{ "name": "pkg", "type": "commonjs" }

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
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v7, v5, v9 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v4, v2, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }

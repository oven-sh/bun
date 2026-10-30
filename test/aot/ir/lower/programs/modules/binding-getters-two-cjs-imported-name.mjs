// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A CommonJS file defines a getter that returns a name of a second file, where a getter returns a binding of the top level. A module imports the
// name from the first file and, beside it, the default, which it looks at as a whole; another module hands the name on.
import outer, { number } from "./outer.cjs";
import { number as handedOn, whole } from "./hands-on.mjs";

console.log(outer, number, handedOn, whole === outer);

// FILE: hands-on.mjs
export { number, default as whole } from "./outer.cjs";

// FILE: inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return number; } });
const number = 1;

// FILE: outer.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var inner_1 = require("./inner.cjs");
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return inner_1.number; } });

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
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="outer"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="number"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="handedOn"
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="whole"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="outer"
// CHECK-NEXT: v17 = StrictEq v14, v16
// CHECK-NEXT: v18 = Call v4, v2, v6, v9, v12, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }

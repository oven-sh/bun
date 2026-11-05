// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 4

// FILE: main.ts
// ES importers of CommonJS files, with and without the marker, with and without a `default`.
declare const console: { log(...values: unknown[]): void };
import { a, b, f } from "./plain.cjs";
import * as plain from "./plain.cjs";
import plainDefault from "./plain.cjs";
import markedDefault, { named, g } from "./marked.cjs";
import * as marked from "./marked.cjs";
// @ts-ignore
import bareDefault from "./markedbare.cjs";
import * as bare from "./markedbare.cjs";
import { default as renamed } from "./marked.cjs";
import * as nodefault from "./nodefault.cjs";
console.log("named", a, b, f(1), named, g());
console.log("ns", plain.a, plain.b, plain.f(2), marked.named, marked.g(), bare.only);
console.log("default", plainDefault.a, plainDefault.f(3), plainDefault.default, markedDefault, renamed, bareDefault.only);
// @ts-ignore
console.log("ns.default", marked.default, bare.default.only, plain.missing, nodefault.default.a);
function later() { return a + plain.a + plainDefault.a; }
console.log("later", later());

// FILE: marked.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.named = exports.default = void 0;
exports.default = "the default"; exports.named = "named";
exports.g = function () { return "g"; };

// FILE: markedbare.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: !0 });
exports.only = "only";

// FILE: nodefault.cjs
exports.a = "a of nodefault";

// FILE: plain.cjs
exports.a = 1; exports.b = "two"; exports.f = function (x) { return x + 1; };
exports.default = "own default of an unmarked module";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: later
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = Convert v0 declared={type=1} illTypedCause=Assertion
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=1 site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=1 site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_1]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }

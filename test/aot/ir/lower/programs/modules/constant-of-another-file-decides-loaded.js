// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.js
// A `const` that another file exports decides a branch in every form an import can take, and the arm that is not taken loads nothing.
import fallback, { debug, debug as renamed, level, text, nothing, missing, big } from "./flags.js";
import { debug as throughExportFrom, other as throughRenamedExportFrom, fallback as defaultExportedAgain } from "./export-from.js";
import { debug as throughStar, second } from "./star.js";
import * as flags from "./flags.js";
import { flags as namespaceExportedAgain, imported as namespaceImportedAndExported } from "./namespace-again.js";
import { doubled, isLoud } from "./computed.js";

if (debug) require("./never.cjs");
if (renamed) await import("./never.mjs");
if (fallback !== 10) require("./never.cjs");
if (level > 3) require("./never.cjs");
if (text !== "quiet") require("./never.cjs");
if (nothing != null) require("./never.cjs");
if (missing !== undefined) require("./never.cjs");
if (big !== 12345678901234567890n) require("./never.cjs");
if (throughExportFrom) require("./never.cjs");
if (throughRenamedExportFrom !== 2) require("./never.cjs");
if (defaultExportedAgain !== 10) require("./never.cjs");
if (throughStar || second !== "second") require("./never.cjs");
if (flags.debug) require("./never.cjs");
if (flags["debug"]) require("./never.cjs");
if (flags?.debug) require("./never.cjs");
if (flags.default !== 10) require("./never.cjs");
if (namespaceExportedAgain.debug) require("./never.cjs");
if (namespaceImportedAndExported.level !== 3) require("./never.cjs");
if (doubled !== 6 || isLoud) require("./never.cjs");
const loaded = debug ? require("./never.cjs") : level === 3 ? require("./taken.cjs") : require("./never.cjs");
function later() {
  if (debug) return import("./never.mjs");
  return flags.level + doubled;
}
console.log(loaded, later(), typeof debug, { debug, level }, `${text}!`, [fallback, nothing, missing, big]);

// FILE: computed.js
import { level, text } from "./flags.js";
export const doubled = level * 2;
export const isLoud = text === "loud";

// FILE: export-from.js
export { debug, default as fallback } from "./flags.js";
export { two as other } from "./second.js";

// FILE: flags.js
console.log("flags runs");
export const debug = false;
export const level = 1 + 2;
export const text = "qui" + "et";
export const nothing = null;
export const missing = undefined;
export const big = 12345678901234567890n;
export default 5 * 2;

// FILE: namespace-again.js
import * as imported from "./flags.js";
export * as flags from "./flags.js";
export { imported };

// FILE: never.cjs
console.log("never.cjs runs");
module.exports = "never";

// FILE: never.mjs
console.log("never.mjs runs");

// FILE: second.js
export const two = 2;
export const second = "second";

// FILE: star.js
export * from "./flags.js";
export * from "./second.js";

// FILE: taken.cjs
console.log("taken.cjs runs");
module.exports = "taken";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: later
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|number|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="debug"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="level"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="doubled"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = Add v4, v7
// CHECK-NEXT: v9 = Integer integer=9
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|Promise flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }

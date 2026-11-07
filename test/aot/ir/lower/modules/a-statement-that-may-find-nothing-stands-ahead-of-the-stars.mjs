// index.mjs exports `paint` of node-or-browser.cjs, a run of which may end without it, and has two `export *`. A link that finds no `paint` there asks the stars of index.mjs, as JavaScriptCore's own
// resolveExport() does, and only the run knows which of them the name stands for. So both stars are followed in the run, shapes.mjs keeps its entry for the name though nobody reads it there, the entry of
// index.mjs goes while its variable is empty, the link of index.mjs asks index.mjs itself for the name and quotes the statement, and main.mjs reads the name off the module.
// `measure`, which every run creates, is bound to its variable as ever.
// RUN: link
// CHECK: module [[shapes]] path="{{*}}shapes.mjs" {{*}}exports=[{name="paint" variable={{*}}}]
// CHECK: module [[face]] path="#{{*}}displayPath="node-or-browser.cjs" {{*}}syntheticExports=[{name="measure" variable=[[measure]]}, {name="paint" variable=[[copy]]}]
// CHECK: module [[index]] path="{{*}}index.mjs" {{*}}requests=[{target=[[shapes]] isDynamicStarExport=true completes=true}, {target={{*}} isDynamicStarExport=true completes=true}, {target=[[face]] completes=true}] exports=[{name="paint" variable=[[copy]] isDroppedWhileEmpty=true}] requiredNames=[{module=[[index]] name="paint" exportName="paint" specifier="./node-or-browser.cjs"}]
// CHECK: module {{*}}main.mjs" {{*}}requiredNames=[{module=[[index]] name="paint"}]
// CHECK: GetModuleVariable variable=[[measure]]
// CHECK: [[space]] = ModuleNamespace module=[[index]]
// CHECK-NEXT: PropGet [[space]] key="paint"

// FILE: main.mjs
import { measure, paint } from "./index.mjs";
console.log(measure, paint);

// FILE: index.mjs
export * from "./shapes.mjs";
export * from "./colors.cjs";
export { measure, paint } from "./node-or-browser.cjs";

// FILE: shapes.mjs
export const paint = "of shapes";
export const unread = 1;

// FILE: colors.cjs
exports.red = 1;

// FILE: node-or-browser.cjs
exports.measure = "measured";
if (typeof window !== "undefined") exports.paint = window.paint;

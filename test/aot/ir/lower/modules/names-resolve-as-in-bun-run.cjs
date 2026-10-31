// RUN: lower
// CHECK-LABEL: function {{*}}name="asSpelled"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="trailingSlash"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="extensionAdded"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="typeScriptExtensionAdded"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="typeScriptForJavaScript"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="indexFile"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="indexFileBehindSlash"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="aboveTheEntryPoint"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="resolve"
// CHECK-NOT: ResolveDynamic
// CHECK: = ResolveModule module=m
// CHECK-NOT: ResolveDynamic
// CHECK-LABEL: function {{*}}name="requireThatAModuleExports"
// CHECK: EvaluateModule module=m
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK: [[result]] = Call {{*}}calleeKey="load"
// CHECK-NEXT: Return [[result]]

const load = require;

function asSpelled() {
  return load("./imports/common.cjs");
}

function trailingSlash() {
  return load("./imports/common.cjs/");
}

function extensionAdded() {
  return load("./imports/common");
}

function typeScriptExtensionAdded() {
  return load("./imports/values");
}

function typeScriptForJavaScript() {
  return load("./imports/values.js");
}

function indexFile() {
  return load("./imports/folder-with-index");
}

function indexFileBehindSlash() {
  return load("./imports/folder-with-index/");
}

function aboveTheEntryPoint() {
  return load("../modules/imports/common.cjs");
}

function resolve() {
  return load.resolve("./imports/common");
}

function requireThatAModuleExports() {
  return load("./imports/exports-its-require.cjs").load("./common.cjs");
}

module.exports = {
  asSpelled,
  trailingSlash,
  extensionAdded,
  typeScriptExtensionAdded,
  typeScriptForJavaScript,
  indexFile,
  indexFileBehindSlash,
  aboveTheEntryPoint,
  resolve,
  requireThatAModuleExports,
};

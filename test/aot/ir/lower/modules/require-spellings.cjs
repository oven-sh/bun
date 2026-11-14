// RUN: lower
// CHECK-LABEL: function {{*}}name="literal"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="constantCondition"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="condition"
// CHECK: SwitchString
// CHECK: EvaluateModule module=m
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="template"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="optionalCall"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="sumOfLiterals"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="shadowedRequire"
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK: = Call
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="shadowedModule"
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK: = Call
// CHECK-NOT: EvaluateModule
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="behindTypeof"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="inTry"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="withoutExtension"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="throughParent"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="constantName"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="constantNameInTemplate"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="oneOfTwoNames"
// CHECK: SwitchString
// CHECK: EvaluateModule module=m
// CHECK: EvaluateModule module=m
// CHECK: = RequireDynamic
// CHECK-LABEL: function {{*}}name="importMetaRequire"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="heldInConstant"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="throughCall"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="throughApply"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="pathJoin"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="nameMadeAtRunTime"
// CHECK: SwitchString
// CHECK: EvaluateModule module=m
// CHECK: = RequireDynamic
// CHECK-LABEL: function {{*}}name="wholeNameMadeAtRunTime"
// CHECK-NOT: EvaluateModule
// CHECK: = RequireDynamic
// CHECK-NOT: EvaluateModule

function literal() {
  return require("./imports/common.cjs");
}

function constantCondition() {
  return require(true ? "./imports/common.cjs" : "./imports/replaces-exports.cjs");
}

function condition(flag) {
  return require(flag ? "./imports/common.cjs" : "./imports/replaces-exports.cjs");
}

function template() {
  return require(`./imports/common.cjs`);
}

function parenthesized() {
  return (require)("./imports/common.cjs");
}

function optionalCall() {
  return require?.("./imports/common.cjs");
}

function sumOfLiterals() {
  return require("./imports/" + "common.cjs");
}

function shadowedRequire(require) {
  return require("./imports/common.cjs");
}

function shadowedModule(module) {
  return module.require("./imports/common.cjs");
}

function behindTypeof() {
  return typeof require === "function" && require("./imports/common.cjs");
}

function inTry() {
  try {
    return require("./imports/common.cjs");
  } catch {
    return null;
  }
}

function withoutExtension() {
  return require("./imports/common");
}

function throughParent() {
  return require("./imports/../imports/common.cjs");
}

function constantName() {
  const name = "common";
  return require("./imports/" + name + ".cjs");
}

function constantNameInTemplate() {
  const name = "common";
  return require(`./imports/${name}.cjs`);
}

function oneOfTwoNames(flag) {
  const name = flag ? "common" : "replaces-exports";
  return require("./imports/" + name + ".cjs");
}

function importMetaRequire() {
  return import.meta.require("./imports/common.cjs");
}

function heldInConstant() {
  const load = require;
  return load("./imports/common.cjs");
}

function throughCall() {
  return require.call(null, "./imports/common.cjs");
}

function throughApply() {
  return require.apply(null, ["./imports/common.cjs"]);
}

function pathJoin() {
  return require(require("node:path").join(__dirname, "imports", "common.cjs"));
}

function nameMadeAtRunTime(letters) {
  return require("./imports/pages/" + letters.join("") + ".ts");
}

function wholeNameMadeAtRunTime(bytes) {
  return require(bytes.toString());
}

module.exports = {
  literal,
  constantCondition,
  condition,
  template,
  parenthesized,
  optionalCall,
  sumOfLiterals,
  shadowedRequire,
  shadowedModule,
  behindTypeof,
  inTry,
  withoutExtension,
  throughParent,
  constantName,
  constantNameInTemplate,
  oneOfTwoNames,
  importMetaRequire,
  heldInConstant,
  throughCall,
  throughApply,
  pathJoin,
  nameMadeAtRunTime,
  wholeNameMadeAtRunTime,
};

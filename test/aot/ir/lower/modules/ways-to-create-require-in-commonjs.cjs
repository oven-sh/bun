// RUN: lower
// CHECK-LABEL: function {{*}}name="byFilename"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="fromVariableToVariable"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="moduleRequire"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="requireUnderAnotherName"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="requireThroughCall"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic
// CHECK-LABEL: function {{*}}name="moduleClass"
// CHECK-NOT: RequireDynamic
// CHECK: EvaluateModule module=m
// CHECK-NOT: RequireDynamic

const { createRequire } = require("module");
const readIntoVariable = require("node:module").createRequire;
const first = require("node:module");
const second = first;
const third = second.createRequire;
const fourth = third;
const ask = require;
const { Module } = require("node:module");

function byFilename() {
  return createRequire(__filename)("./imports/common.cjs");
}

function member() {
  return readIntoVariable(__filename)("./imports/common.cjs");
}

function fromVariableToVariable() {
  return fourth(__filename)("./imports/common.cjs");
}

function moduleRequire() {
  return module.require("node:module").createRequire(__filename)("./imports/common.cjs");
}

function requireUnderAnotherName() {
  return ask("node:module").createRequire(__filename)("./imports/common.cjs");
}

function requireThroughCall() {
  return require.call(null, "module").createRequire(__filename)("./imports/common.cjs");
}

function moduleClass() {
  return Module.createRequire(__filename)("./imports/common.cjs");
}

module.exports = {
  byFilename,
  member,
  fromVariableToVariable,
  moduleRequire,
  requireUnderAnotherName,
  requireThroughCall,
  moduleClass,
};

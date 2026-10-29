// RUN(BOUND): lower
// BOUND-LABEL: function {{*}}name="bound"
// BOUND: EvaluateModule module=m
// BOUND-NOT: isBare
// BOUND-NOT: PropGet
// BOUND-NOT: ModuleNamespace
// BOUND: [[one]] = GetModuleVariable
// BOUND: Return

// RUN(CALLED): lower
// CALLED-LABEL: function {{*}}name="called"
// CALLED: EvaluateModule module=m
// CALLED-NOT: PropGet
// CALLED: [[read]] = GetModuleVariable
// CALLED: [[receiver]] = ModuleNamespace module=m
// CALLED: = Call {{*}}[[receiver]]
// CALLED: Return

// RUN(ABSENT): lower
// ABSENT-LABEL: function {{*}}name="absent"
// ABSENT: EvaluateModule module=m
// ABSENT-NOT: PropGet
// ABSENT-NOT: ModuleNamespace
// ABSENT: = Undefined
// ABSENT: Return

// RUN(HANDED): lower
// HANDED-LABEL: function {{*}}name="handedOn"
// HANDED: EvaluateModule module=m
// HANDED: = ModuleNamespace module=m
// HANDED: Return

// RUN(MARKER): lower
// MARKER-LABEL: function {{*}}name="marker"
// MARKER: EvaluateModule module=m
// MARKER-NOT: PropGet
// MARKER: = Boolean boolean=true
// MARKER: Return

// RUN(STORED): lower
// STORED-LABEL: function {{*}}name="storedAgain"
// STORED: EvaluateModule module=m
// STORED: = ModuleNamespace module=m
// STORED-NOT: GetModuleVariable
// STORED: = PropGet {{*}}key="one"
// STORED: Return

// RUN(COMMONJS): lower
// COMMONJS-LABEL: function {{*}}name="ofCommonJs"
// COMMONJS: EvaluateModule module=m
// COMMONJS-NOT: PropGet
// COMMONJS: = GetModuleVariable
// COMMONJS: Return

// RUN(NOWHERE): lower
// NOWHERE-NOT: RequireModule

// RUN(REQUESTS): link
// REQUESTS: module {{*}}constant-holds-required-es-module{{*}}requests=[{{*}}kind=Require

// A require of a constant path is a synchronous import at that point: an operation that says "the module has run, is running, or throws its error", and reads of the module's variables. The namespace object is asked for only where the result is a value.
function absent() {
  const all = require("./imports/values");
  return all.missing;
}

function bound() {
  const all = require("./imports/values");
  return all.one;
}

function called() {
  const all = require("./imports/values");
  return all.bump();
}

function handedOn() {
  const all = require("./imports/values");
  return all;
}

function marker() {
  const all = require("./imports/values");
  return all.__esModule;
}

function ofCommonJs() {
  const all = require("./imports/common.cjs");
  return all.named;
}

function storedAgain() {
  let all = require("./imports/values");
  all = { one: 2 };
  return all.one;
}

module.exports = { absent, bound, called, handedOn, marker, ofCommonJs, storedAgain };

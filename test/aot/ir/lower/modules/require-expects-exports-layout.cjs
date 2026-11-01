// RUN(KNOWN): link
// KNOWN: layout [[common]] module=[[imported]] fields=[{key="named" declared={type=anything}}, {key="other" declared={type=anything}}]
// KNOWN: module [[imported]] path="{{*}}/imports/common.cjs"{{*}}exportsVariable=[[exports]]
// KNOWN-LABEL: function {{*}}name="known"
// KNOWN: EvaluateModule module=[[imported]]
// KNOWN-NEXT: [[required]] = GetModuleVariable variable=[[exports]]
// KNOWN-NEXT: = Convert [[required]] declared={type=[[common]] flags=[IsExpected]}

// RUN(CONDITIONAL): link
// CONDITIONAL-LABEL: function {{*}}name="conditional"
// CONDITIONAL: RecordRequire module=[[first]]
// CONDITIONAL-NEXT: EvaluateModule module=[[first]]
// CONDITIONAL-NEXT: RecordRequire module=[[first]]
// CONDITIONAL-NEXT: [[required]] = GetModuleVariable
// CONDITIONAL-NEXT: = Convert [[required]] declared={type=L{{*}} flags=[IsExpected]}
// CONDITIONAL: RecordRequire module=[[second]]
// CONDITIONAL-NEXT: EvaluateModule module=[[second]]
// CONDITIONAL-NEXT: RecordRequire module=[[second]]
// CONDITIONAL-NEXT: = GetModuleVariable
// CONDITIONAL-NEXT: Jump

// RUN(REPLACED): link
// REPLACED-LABEL: function {{*}}name="replaced"
// REPLACED: EvaluateModule module=m
// REPLACED-NEXT: [[required]] = GetModuleVariable
// REPLACED-NOT: = Convert [[required]] declared={type=L
// REPLACED: Return

// RUN(IMPORTED): link
// IMPORTED-LABEL: function {{*}}name="imported"
// IMPORTED: [[promise]] = ImportModule
// IMPORTED-NOT: = Convert [[promise]] declared={type=L
// IMPORTED-NOT: = Convert [[promise]] declared={type=undefined|null|L
// IMPORTED: Return

// RUN(NOWHERE): link
// NOWHERE-NOT: RequireModule

// The result of each require is a value here, so the modules keep an exports object, in one variable each. A require reads that variable at every evaluation of the call.
function known() {
  return require("./imports/common.cjs");
}

function conditional(flag) {
  return require(flag ? "./imports/common.cjs" : "./imports/replaces-exports.cjs");
}

function replaced() {
  return require("./imports/replaces-exports.cjs");
}

function imported() {
  return import("./imports/common.cjs");
}

module.exports = { known, conditional, replaced, imported };

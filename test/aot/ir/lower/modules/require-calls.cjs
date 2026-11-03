// DIAGNOSTIC: TS100150 1

// RUN(KNOWN): lower
// KNOWN-LABEL: function {{*}}name="known"
// KNOWN-NOT: = Call
// KNOWN-NOT: StrictEq
// KNOWN-NOT: RequireModule
// KNOWN: EvaluateModule module=m
// KNOWN-NOT: isBare
// KNOWN: = GetModuleVariable
// KNOWN: Return

// RUN(MEMBER): lower
// MEMBER-LABEL: function {{*}}name="viaModule"
// MEMBER-NOT: = Call
// MEMBER-NOT: = PropGet
// MEMBER-NOT: RequireModule
// MEMBER: EvaluateModule module=m
// MEMBER: = GetModuleVariable
// MEMBER: Return

// RUN(COMPUTED): lower
// COMPUTED-LABEL: function {{*}}name="computed"
// COMPUTED: [[specifier]] = Add
// COMPUTED: SwitchString [[specifier]] strings=["./imports/pages/first", "./imports/pages/first.js", {{*}}"./imports/pages/second.ts"] -> case [[first]](), {{*}}otherwise [[other]]()
// COMPUTED: [[first]]():
// COMPUTED-NEXT: RecordRequire module=m
// COMPUTED-NEXT: EvaluateModule module=m
// COMPUTED: [[other]]():
// COMPUTED-NEXT: = RequireDynamic [[specifier]] referrer=m
// COMPUTED: Return

// RUN(CONDITIONAL): lower
// CONDITIONAL-LABEL: function {{*}}name="conditional"
// CONDITIONAL-NOT: RequireDynamic
// CONDITIONAL: SwitchString {{*}}strings=["./imports/pages/first.ts", "./imports/pages/second.ts"] -> case [[first]](), case [[second]](), otherwise [[other]]()
// CONDITIONAL: [[first]]():
// CONDITIONAL-NEXT: RecordRequire module=m
// CONDITIONAL-NEXT: EvaluateModule module=m
// CONDITIONAL-NOT: RequireDynamic
// CONDITIONAL: [[other]]():
// CONDITIONAL-NEXT: Unreachable
// CONDITIONAL-NEXT: }

// RUN(PARTLY): lower
// PARTLY-LABEL: function {{*}}name="partlyConstant"
// PARTLY: SwitchString {{*}}otherwise [[other]]()
// PARTLY: [[other]]():
// PARTLY-NEXT: = RequireDynamic
// PARTLY: Return

// RUN(UNKNOWN): lower
// UNKNOWN-LABEL: function {{*}}name="unknown"
// UNKNOWN-NOT: SwitchString
// UNKNOWN: = RequireDynamic
// UNKNOWN-NOT: SwitchString
// UNKNOWN: Return

// RUN(EFFECTS): lower
// EFFECTS-LABEL: function {{*}}name="effects"
// EFFECTS: = Call
// EFFECTS: EvaluateModule module=m
// EFFECTS: Return

// RUN(MISSING): lower
// MISSING-LABEL: function {{*}}name="missing"
// MISSING: = ResolveDynamic {{*}}referrer=m{{*}} [isForRequire]
// MISSING-NEXT: ThrowModuleFailure failure=q
// MISSING-NEXT: Unreachable

// RUN(SPREAD): lower
// SPREAD-LABEL: function {{*}}name="spread"
// SPREAD-NOT: RequireDynamic
// SPREAD: = CallList
// SPREAD: Return

function known() {
  return require("./imports/common.cjs");
}

function viaModule() {
  return module.require("./imports/common.cjs");
}

function computed(name) {
  return require("./imports/pages/" + name);
}

function conditional(flag) {
  return require(flag ? "./imports/pages/first.ts" : "./imports/pages/second.ts");
}

function partlyConstant(flag, name) {
  return require(flag ? "./imports/pages/first.ts" : "./imports/pages/" + name);
}

function unknown(name) {
  return require(name);
}

function effects(log) {
  return require("./imports/common.cjs", log());
}

function missing() {
  return require("./imports/none");
}

function spread(list) {
  return require(...list);
}

module.exports = { known, viaModule, computed, conditional, partlyConstant, unknown, effects, missing, spread };

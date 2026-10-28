// A `var` holds `undefined` above its statement, so the call stands behind a test. A call of `undefined` throws: what comes out is the module all the same.

// RUN(MEMBER): lower
// MEMBER-LABEL: function {{*}}name="member"
// MEMBER: [[empty]] = StrictEq [[callee]], [[undefined]]
// MEMBER-NEXT: Branch [[empty]] -> taken [[notFilled]](), notTaken [[filled]]()
// MEMBER: [[notFilled]]():
// MEMBER-NEXT: = Call [[callee]], -, {{*}}calleeName="load"
// MEMBER: [[filled]]():
// MEMBER-NEXT: EvaluateModule module=m
// MEMBER-NEXT: = Boolean boolean=true
// MEMBER: [[named]] = GetModuleVariable
// MEMBER-NEXT: Return [[named]]

// RUN(META): lower
// META-LABEL: function {{*}}name="throughImportMeta"
// META: Branch {{*}} -> taken [[notFilled]](), notTaken [[filled]]()
// META: [[filled]]():
// META-NEXT: EvaluateModule module=m
// META-NEXT: = Boolean boolean=true
// META: [[other]] = GetModuleVariable
// META-NEXT: Return [[other]]

// RUN(UNREAD): lower
// UNREAD-LABEL: function {{*}}name="holder"
// UNREAD: EvaluateModule module=m
// UNREAD-NEXT: = Boolean boolean=true
// UNREAD: [[named]] = GetModuleVariable
// UNREAD-NEXT: Return [[named]]
// UNREAD-LABEL: function {{*}}name="pattern"
// UNREAD: EvaluateModule module=m
// UNREAD-NEXT: = Boolean boolean=true
// UNREAD-LABEL: function {{*}}name="statement"
// UNREAD: EvaluateModule module=m
// UNREAD-NEXT: = Boolean boolean=true
// UNREAD-LABEL: function {{*}}name="tested"
// UNREAD: EvaluateModule module=m
// UNREAD-NEXT: = Boolean boolean=true

// RUN(VALUE): lower
// VALUE-LABEL: function {{*}}name="value"
// VALUE: Branch {{*}} -> taken [[notFilled]](), notTaken [[filled]]()
// VALUE: [[filled]]():
// VALUE-NEXT: EvaluateModule module=m
// VALUE-NOT: Boolean
// VALUE: = GetModuleVariable
// VALUE: Return

import { createRequire } from "node:module";

var load = createRequire(import.meta.url);
var meta = import.meta.require;

export function member() {
  return load("./imports/common.cjs").named;
}

export function throughImportMeta() {
  return meta("./imports/common.cjs").other;
}

export function statement() {
  load("./imports/common.cjs");
}

export function holder() {
  const held = load("./imports/common.cjs");
  return held.named;
}

export function pattern() {
  const { other } = load("./imports/common.cjs");
  return other;
}

export function tested() {
  return load("./imports/common.cjs") ? 1 : 2;
}

export function value() {
  return load("./imports/replaces-exports.cjs");
}

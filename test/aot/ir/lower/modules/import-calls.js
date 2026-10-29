// DIAGNOSTIC: TS100150 1

// RUN(KNOWN): lower
// KNOWN-LABEL: function {{*}}name="known"
// KNOWN: = ImportModule module=m
// KNOWN: Return

// RUN(PREFIXED): lower
// PREFIXED-LABEL: function {{*}}name="prefixed"
// PREFIXED: SwitchString [[specifier]] strings=["./imports/pages/first.ts", "./imports/pages/second.ts"] -> case [[first]](), case [[second]](), otherwise [[other]]()
// PREFIXED: [[first]]():
// PREFIXED-NEXT: = ImportModule module=m
// PREFIXED: [[second]]():
// PREFIXED-NEXT: = ImportModule module=m
// PREFIXED: [[other]]():
// PREFIXED-NEXT: = ImportDynamic [[specifier]] referrer=m
// PREFIXED: Return

// RUN(UNKNOWN): lower
// UNKNOWN-LABEL: function {{*}}name="unknown"
// UNKNOWN-NOT: SwitchString
// UNKNOWN: = ImportDynamic
// UNKNOWN-NOT: SwitchString
// UNKNOWN: Return

// RUN(WITHOPTIONS): lower
// WITHOPTIONS-LABEL: function {{*}}name="prefixedWithOptions"
// WITHOPTIONS-NOT: SwitchString
// WITHOPTIONS: = ImportDynamic [[specifier]], [[options]] referrer=m
// WITHOPTIONS-NOT: SwitchString
// WITHOPTIONS: Return

// RUN(SECOND): lower
// SECOND-LABEL: function {{*}}name="withOptions"
// SECOND: = ImportDynamic [[specifier]], [[options]] referrer=m
// SECOND: Return

// RUN(MISSING): lower
// MISSING-LABEL: function {{*}}name="missing"
// MISSING: handler=[[handler]]():
// MISSING-NEXT: ThrowModuleFailure failure=q
// MISSING-NEXT: Unreachable
// MISSING: [[handler]]() role=CatchHandler:
// MISSING-NEXT: [[error]] = CatchValue
// MISSING: [[reject]] = Builtin builtin=PromiseReject
// MISSING: = Call [[reject]], {{*}}, [[error]]
// MISSING: Return

import "./imports/pages/first";
import "./imports/pages/second";

export function known() {
  return import("./imports/values");
}

export function prefixed(name) {
  return import("./imports/pages/" + name + ".ts");
}

export function unknown(name) {
  return import(name);
}

export function prefixedWithOptions(name, options) {
  return import("./imports/pages/" + name + ".ts", options);
}

export function withOptions(name, options) {
  return import(name, options);
}

export function missing() {
  return import("./imports/none");
}

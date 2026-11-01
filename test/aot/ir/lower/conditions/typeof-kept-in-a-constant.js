// RUN: lower
// CHECK-LABEL: function {{*}}name="changedKind"
// CHECK: = StrictEq
// CHECK-LABEL: function {{*}}name="changedValue"
// CHECK: = StrictEq
// CHECK-LABEL: function {{*}}name="hoistedKind"
// CHECK: = StrictEq
// CHECK-LABEL: function {{*}}name="hoistedValue"
// CHECK: = StrictEq
// CHECK-LABEL: function {{*}}name="kept"
// CHECK: b0([[value]]: {{*}}):
// CHECK-NOT: StrictEq
// CHECK: [[isText]] = TypeTest [[value]] testedType=string
// CHECK-NEXT: Branch [[isText]] -> taken [[text]](| 0), notTaken [[rest]](| 0)
// CHECK: [[text]]([[proven]]):
// CHECK: = PropGet [[proven]] key="length"
// CHECK-LABEL: function {{*}}name="ofMember"
// CHECK: = StrictEq
// RUN(OUTSIDE): lower
// OUTSIDE-LABEL: function {{*}}name="asksOutside"
// OUTSIDE: = StrictEq
export function changedKind(value) { let kind = typeof value; if (value === null) kind = "null"; return kind === "string"; }
export function changedValue(value) { const kind = typeof value; value = 1; return kind === "string"; }
export function hoistedKind(value) { const early = kind === "string"; var kind = typeof value; return early; }
export function hoistedValue(given) { const kind = typeof value; var value = given; return kind === "string" ? value : 0; }
export function kept(value) { const kind = typeof value; return kind === "string" ? value.length : 0; }
export function keptOutside(value) { const kind = typeof value; return function asksOutside() { return kind === "string"; }; }
export function ofMember(holder) { const kind = typeof holder.held; return kind === "string"; }

// RUN(BOUND): lower
// BOUND-LABEL: function {{*}}name="bound"
// BOUND-COUNT-4: = GetModuleVariable
// BOUND-NOT: = GetModuleVariable
// BOUND: Return

// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="bound"
// OBJECT-NOT: ModuleNamespace
// OBJECT: Return

// RUN(ABSENT): lower
// ABSENT-LABEL: function {{*}}name="absent"
// ABSENT-NOT: GetModuleVariable
// ABSENT: [[namespace]] = ModuleNamespace module=m
// ABSENT-NEXT: [[object]] = Convert [[namespace]]
// ABSENT-NEXT: [[receiver]] = Convert [[object]] declared={type={{*}}flags=[IsExpected]}
// ABSENT-NEXT: = PropGet [[receiver]] key="missing"
// ABSENT: Return

// RUN(COMPUTED): lower
// COMPUTED-LABEL: function {{*}}name="computed"
// COMPUTED: [[namespace]] = ModuleNamespace module=m
// COMPUTED-NEXT: [[object]] = Convert [[namespace]]
// COMPUTED-NEXT: = ElemGet [[object]],
// COMPUTED: Return

import * as all from "./imports/values";

export function bound() {
  return [all.one, all["counter"], (all as any).one, all.nested.deep];
}

export function absent() {
  return (all as any).missing;
}

export function computed(key: string) {
  return (all as any)[key];
}

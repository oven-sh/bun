// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK: [[one]] = GetModuleVariable variable=g
// CHECK-NEXT: = CheckInitialized [[one]] name="one"
// CHECK: = CheckInitialized {{*}}name="counter"
// CHECK: = CheckInitialized {{*}}name="text"
// CHECK-NOT: = CheckInitialized
// CHECK: = ModuleNamespace module=m
// CHECK: Return

// RUN(READS): lower
// READS-LABEL: function {{*}}name="read"
// READS-COUNT-4: = GetModuleVariable
// READS-NOT: = GetModuleVariable
// READS: Return

// RUN(MEMBERS): lower
// MEMBERS-LABEL: function {{*}}name="read"
// MEMBERS-NOT: = PropGet
// MEMBERS: Return

import text, { counter, one } from "./imports/values";
import { named } from "./imports/common.cjs";
import * as all from "./imports/values";

export function read() {
  return [one, counter, text, named, all];
}

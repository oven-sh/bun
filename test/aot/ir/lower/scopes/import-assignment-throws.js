// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[error]] = NewRuntimeError runtimeError=ImportAssignment name="a"
// CHECK-NEXT: Throw [[error]]

// RUN(STORE): lower
// STORE-NOT: PutModuleVariable

import { a } from "./imports/a.js";

a = 1;

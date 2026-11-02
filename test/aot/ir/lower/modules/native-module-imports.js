// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK: [[variable]] = GetModuleVariable variable=g
// CHECK-NEXT: = CheckInitialized [[variable]] name="heapStats"
// CHECK: Return

// RUN(STORAGE): lower
// STORAGE-LABEL: function {{*}}name="read"
// STORAGE-NOT: ModuleNamespace
// STORAGE-NOT: RequireModule
// STORAGE-NOT: PropGet
// STORAGE: Return

// A test build loads none of Bun's own modules, so `bun:jsc` is a value of the host and a name of it is a variable that link defines.
import { heapStats } from "bun:jsc";

export function read() {
  return heapStats;
}

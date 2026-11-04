// RUN: link
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helperOfUnused"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// What `import()` answers with holds every export.
export async function load(): Promise<number> {
  const functions = await import("./imports/two-functions");
  return functions.used();
}

// RUN: lower
// CHECK-LABEL: function {{*}}name="readFolded"
// CHECK-NOT: GetModuleVariable
// CHECK-NOT: CheckInitialized
// CHECK: Return
// CHECK-LABEL: function {{*}}name="readJoined"
// CHECK: [[read]] = GetModuleVariable
// CHECK: CheckInitialized [[read]] name="joined"

enum Mode {
  Slow,
  Fast = 4,
  Named = "named",
}
export const mode = Mode.Fast;
const flags = Mode.Slow | mode;
const size = Mode.Named.length;
const item = ["a", "b"][Mode.Slow];
const joined = Mode.Named + "!";

export function readFolded() {
  return [mode, flags, size, item];
}

export function readJoined() {
  return joined;
}

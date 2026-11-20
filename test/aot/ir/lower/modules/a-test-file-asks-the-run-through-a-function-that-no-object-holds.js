// A test file that imports the runner asks the run, while it loads, which of the runner's names a script had laid on the global object.
// It asks a function that no object holds. `Bun.jest` as the file itself spells it is the member of `Bun`, read where it is called, whatever it is called with.
// RUN: lower
// OPTIONS: runs-tests
// CHECK: [[asked]] = Builtin builtin=CompilerHelpersAskRunOfTestFile
// CHECK: = Call [[asked]]
// CHECK-LABEL: function {{*}}name="written"
// CHECK-NOT: CompilerHelpersAskRunOfTestFile
// CHECK: = PropGet {{*}}key="jest"
// CHECK: = Call {{*}}calleeName="Bun.jest"
import { test } from "bun:test";
export function written(path) {
  return Bun.jest(path, true, true);
}
test("reads a name of the runner that it does not import", () => {
  expect(written(import.meta.path));
});

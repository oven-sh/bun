// A test run asks the system about each module that it names, for the stamp of its file. The system reads a path up to its first NUL: it would answer for another file than the one that is named,
// and a Bun with assertions stops there ("ZStr::as_cstr: interior NUL would truncate the C view"). Such a name is the path of no file, and has no stamp.
// RUN: link
// OPTIONS: runs-tests
// CHECK: module [[main]] path="{{*}}/main.ts"
// CHECK: sourcestamp module=[[main]] low=
// CHECK-NOT: sourcestamp

// FILE: main.ts
// @ts-expect-error
import("\0made:up").catch(() => console.log("nothing is there"));

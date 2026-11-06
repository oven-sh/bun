// RUN: link
// CHECK-LABEL: function {{*}}name="make"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="measured"
// CHECK-NOT: Return
// CHECK: [[errorOfMeasured]] = NewRuntimeError runtimeError=LeftOutOfExecutable
// CHECK-NEXT: Throw [[errorOfMeasured]]

// A name in a type is not evaluated. The type of the function is found all the same.
function measured(): { size: number } {
  return { size: 1 };
}

export function make(): ReturnType<typeof measured> {
  return { size: 2 };
}

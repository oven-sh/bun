// RUN: lower
// CHECK-LABEL: function {{*}}name="copy"
// CHECK-NOT: illTypedCause=
// CHECK-LABEL: function {{*}}name="keep"
// CHECK-NOT: Convert {{*}}declared={type=undefined|null|"read"|"write"}
// CHECK: = Convert {{*}}declared={type=undefined|null|"read"|"write" site=w{{*}}} illTypedCause=Assertion

// The reference is not claimed to be one of two strings. The variable that takes only those two has the conversion, and it says that the checker's word for
// the value rests on a comparison. The variable that takes all three rests on nothing.
type Mode = "off" | "read" | "write";
let kept: "read" | "write" = "read";
let wide: Mode = "off";

export function keep(mode: Mode): void {
  if (mode !== "off") kept = mode;
}

export function copy(mode: Mode): void {
  if (mode !== "off") wide = mode;
}

export function show(): string {
  return kept + wide;
}

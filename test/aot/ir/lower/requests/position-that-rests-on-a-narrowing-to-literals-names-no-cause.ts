// RUN: lower
// CHECK-LABEL: function {{*}}name="copy"
// CHECK-NOT: illTypedCause=
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: b0([[mode]]: {{*}}):
// CHECK-NOT: Convert
// CHECK: [[stored]] = Convert [[mode]] declared={type=undefined|null|"read"|"write" flags=[OmitsNull, OmitsUndefined]} @
// CHECK-NEXT: PutModuleVariable [[stored]]
// CHECK-NOT: illTypedCause=

// The reference is not claimed to be one of two strings. The variable that takes only those two has the conversion, and the engine tests it. It names no cause,
// like the conversion into the variable that takes all three: nobody asks what the checker's word for the value rests on.
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

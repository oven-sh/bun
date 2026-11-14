// RUN: link
// CHECK-LABEL: function {{*}}name="underItsOwnText"
// CHECK-NOT: PropGet {{*}}key="abs"
// CHECK: ElemGet
// CHECK-LABEL: function {{*}}name="underString"
// CHECK-NOT: ElemGet
// CHECK: PropGet {{*}}key="abs"

// FILE: main.ts
// In a checked file `x as T` is a conversion that is made at the run. Under a keyword that accepts it a constant stays a constant, and the read is a read by name. Under any other
// type the key is what the conversion hands on: a read under a computed key, which may enter whatever the holder has. Whoever tells the load what the program enters reads the key
// the same way: it took this one for `Math.abs`, and the build stopped over the functions of the library that the load had left out.
export function underItsOwnText() {
  return Math["abs" as "abs"](-1);
}
export function underString() {
  return (Math as unknown as Record<string, (value: number) => number>)["abs" as string](-1);
}

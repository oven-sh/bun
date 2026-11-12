// RUN: lower
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: Switch {{*}}cases=[0, 1] -> case {{*}}, case [[entered]](| 0),
// CHECK: [[entered]]({{*}}):
// CHECK: = NewClosure {{*}}function=[[read]]
// CHECK: function [[read]] name="read" {{*}}kind=Arrow
// CHECK-NOT: Return
// CHECK: = CheckInitialized {{*}}name="x"

// A `switch` that enters at `case 1` has not run the declaration in `case 0`, so the closure tests `x`. `bun run` prints "set" in place of the name.
export function pick(n) {
  switch (n) {
    case 0:
      const x = "set";
      return () => x;
    case 1:
      const read = () => x;
      return read;
  }
}

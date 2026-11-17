// RUN: lower
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: Switch {{*}}cases=[0, 1] -> case {{*}}, case [[entered]](| 0),
// CHECK: [[entered]]({{*}}):
// CHECK: = NewClosure {{*}}function=[[read]]
// CHECK: function [[read]] {{*}}kind=Arrow
// CHECK-NOT: Return
// CHECK: = CheckInitialized {{*}}name="x"

// A `switch` that enters at `case 1` has not run the declaration in `case 0`, so the closure tests `x`. `bun run` prints "set" in place of the name.
// `const read = ..; return read;` runs as `return ..;`, so the arrow has no name: it is found by the closure that `case 1` makes.
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

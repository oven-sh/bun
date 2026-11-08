// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="level"
// CHECK-NEXT: Return [[read]]

// A read of a member is converted to nothing, whether a slot or an accessor answers it. The result of `f` has no annotation, so it is untyped.
class G {
  get level(): number {
    return 1;
  }
}

export function f(g: G) {
  return g.level;
}

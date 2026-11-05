// RUN: lower
// `namespace Path.Tools {}` runs `Path.Tools || (Path.Tools = {})`. Path extends Shape, so the read finds Shape.Tools: the block fills that object, and Path gets no member.
// A namespace that is a variable is made at once: every store to a variable is seen.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[found]] = PropGet {{*}}key="Tools"
// CHECK: ToBoolean [[found]]
// CHECK: [[again]] = PropGet {{*}}key="Tools"
// CHECK: ToBoolean [[again]]
// CHECK: PropSet {{*}}key="alone"
// CHECK-NOT: ToBoolean

class Shape {}
namespace Shape.Tools {
  export function first() {
    return 1;
  }
}
class Path extends Shape {}
namespace Path.Tools {
  export function second() {
    return 2;
  }
}
namespace Alone {
  export const alone = "set";
}
export const all = [Shape.Tools, Path.Tools, Alone];

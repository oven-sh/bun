// RUN: lower
// CHECK: PropSet [[box]], {{*}}key="x"
// CHECK: [[gone]] = PropDelete [[box]] key="x" mode=Sloppy
// CHECK: PropSet [[box]], {{*}}key="gone"

namespace N {
  export let x = 1;
  // @ts-ignore
  export const gone = delete x;
}
console.log(N.gone, "x" in N);

// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: key="x"
// CHECK: PropSet {{*}}key="y"
// CHECK-NOT: key="x"

export namespace N {
  export let x: unknown;
  export let y = 1;
}

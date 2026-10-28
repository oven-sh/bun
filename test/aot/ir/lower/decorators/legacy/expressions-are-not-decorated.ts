// RUN: lower
// CHECK-NOT: CompilerHelpers
// CHECK: DefineMethod {{*}}key="m"
// CHECK-NOT: CompilerHelpers

declare const d: any;

export const C = class {
  // @ts-expect-error
  @d m() {}
};

// RUN: lower
// CHECK-COUNT-1: DefineMethod {{*}}key="f"
// CHECK-NOT: DefineMethod

// RUN(EARLIER): lower
// EARLIER-NOT: DefineMethod
// EARLIER: DefineMethod {{*}}key="f"

// RUN(INITIALIZER): lower
// INITIALIZER-NOT: kind=Initializer
// INITIALIZER-NOT: CallDirect

export abstract class C {
  declare x: number;
  abstract m(): void;
  [index: string]: unknown;
  f(a: number): void;
  f(a: string): void;
  f(a: unknown) {}
}

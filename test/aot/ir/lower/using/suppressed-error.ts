// RUN: lower
// CHECK-LABEL: function {{*}}name="combines"
// CHECK-NOT: role=CatchHandler
// CHECK-NOT: NewSuppressedError
// CHECK: role=DisposalCleanup
// CHECK-NEXT: [[thrown]] = CatchValue
// CHECK: role=CatchHandler
// CHECK-NEXT: [[error]] = CatchValue
// CHECK-NEXT: [[combined]] = NewSuppressedError [[error]], [[thrown]]
// CHECK-NEXT: Throw [[combined]]
// CHECK-NOT: role=CatchHandler
// CHECK-NOT: NewSuppressedError

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function combines() {
  using a = resource();
  use(1);
}

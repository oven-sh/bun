// RUN: lower
// CHECK-LABEL: function {{*}}name="asynchronous"
// CHECK: role=CatchHandler
// CHECK-NEXT: [[normalError]] = CatchValue
// CHECK-NOT: NewSuppressedError
// CHECK: [[afterNormalError]] = Undefined
// CHECK-NEXT: = Await [[afterNormalError]]
// CHECK: Throw [[normalError]]
// CHECK: role=CatchHandler
// CHECK-NEXT: = CatchValue
// CHECK-NEXT: [[combined]] = NewSuppressedError
// CHECK: [[afterCombinedError]] = Undefined
// CHECK-NEXT: = Await [[afterCombinedError]]
// CHECK: Throw [[combined]]
// CHECK-NOT: role=CatchHandler

declare function use(value: unknown): void;
declare function asyncResource(): AsyncDisposable;

export async function asynchronous() {
  await using a = asyncResource();
  use(1);
}

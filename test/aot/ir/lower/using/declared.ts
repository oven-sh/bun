// @ts-nocheck
// RUN: lower
// CHECK-NOT: DisposeMethod
// CHECK-NOT: key="resource"
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK-NOT: DisposeMethod
// CHECK-NOT: key="resource"
// CHECK: key="kept"
// CHECK-NOT: DisposeMethod
// CHECK-NOT: key="resource"

// `declare` erases a declaration with its initializer. `bun run` reports a syntax error here, TypeScript an error that does not count in a file that is not checked.

declare function resource(): Disposable & AsyncDisposable;
declare function kept(): void;

declare using atTopLevel = resource();
{
  declare using inBlock = resource();
}

export async function inFunction() {
  declare using first = resource();
  declare await using second = resource();
  kept();
}

// RUN: lower
// CHECK-LABEL: function {{*}}name="underCatch"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromCatchRegion]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="underFinally"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromFinallyRegion]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="underIteratorClose"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromLoop]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="underUsing"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromResourceScope]]
// CHECK-NOT: ReturnCall

declare function call(): number;
declare function resource(): Disposable;
declare const list: number[];

export function underCatch() {
  try {
    return call();
  } catch {
    return 0;
  }
}

export function underFinally() {
  try {
    return call();
  } finally {
  }
}

export function underIteratorClose() {
  for (const x of list) {
    return call();
  }
  return 0;
}

export function underUsing() {
  using r = resource();
  return call();
}

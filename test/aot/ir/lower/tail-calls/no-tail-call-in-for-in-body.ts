// RUN: lower
// CHECK-LABEL: function {{*}}name="afterForIn"
// CHECK: ReturnCall
// CHECK-LABEL: function {{*}}name="inForIn"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromBody]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="inLoopInForIn"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromInnerLoop]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="inWhile"
// CHECK: ReturnCall

declare function call(): number;
declare const record: Record<string, number>;

export function afterForIn() {
  for (const key in record) {
    call();
  }
  return call();
}

export function inForIn() {
  for (const key in record) {
    return call();
  }
  return 0;
}

export function inLoopInForIn() {
  for (const key in record) {
    while (record[key] > 0) {
      return call();
    }
  }
  return 0;
}

export function inWhile() {
  while (record.a > 0) {
    return call();
  }
  return 0;
}

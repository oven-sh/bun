// RUN: lower
// CHECK-LABEL: function {{*}}name="asyncFunction"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromAsyncFunction]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="generator"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromGenerator]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="Constructed"
// CHECK-NOT: ReturnCall
// CHECK: Return [[fromConstructor]]
// CHECK-NOT: ReturnCall

declare function call(): number;

export async function asyncFunction() {
  return call();
}

export function* generator() {
  return call();
}

export class Constructed {
  constructor() {
    return call() as any;
  }
}

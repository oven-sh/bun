// RUN: lower
// CHECK-LABEL: function {{*}}name="elsewhere"
// CHECK-NOT: = NewDictionary
// CHECK: PropSet {{*}} key="other"
// CHECK-LABEL: function {{*}}name="empty"
// CHECK-NOT: = Data
// CHECK-NOT: = NewObject
// CHECK: = NewDictionary
// CHECK: PropSet {{*}} key="prototype"
// CHECK-LABEL: function {{*}}name="filled"
// CHECK-NOT: = Data
// CHECK-NOT: = NewObject
// CHECK: = NewDictionary
// CHECK: PropSet {{*}} key="prototype"
interface Members {
  run(): number;
  limit: number;
}
interface Maker {
  (this: object): void;
  prototype: Members;
  other: Members;
}
export function empty(maker: Maker): Members {
  const members = (maker.prototype = {} as Members);
  return members;
}
export function filled(maker: Maker): void {
  maker.prototype = { run: () => 1, limit: 2 };
}
export function elsewhere(maker: Maker): void {
  maker.other = { run: () => 1, limit: 2 };
}

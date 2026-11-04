// RUN: lower
// CHECK-LABEL: function {{*}}name="overArray"
// CHECK: = IteratorOpen [[iterable]]
// CHECK: [[value]] = ResultAt {{*}}index=1
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[value]] calleeName="use"
// CHECK-LABEL: function {{*}}name="overPromises"
// CHECK: [[settled]] = ResultAt {{*}}index=1
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[settled]] calleeName="use"

// The name in the head of the loop has no annotation, so what a step delivers is converted to nothing and the name holds it as it came. For `for await` that is the settled value.
declare function use(value: unknown): void;

export function overArray(items: number[]) {
  for (const item of items) use(item);
}

export async function overPromises(items: Promise<number>[]) {
  for await (const item of items) use(item);
}

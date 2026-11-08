// RUN: lower
// CHECK-LABEL: function {{*}}name="overArray"
// CHECK: = IteratorOpen [[iterable]]
// CHECK: [[value]] = ResultAt {{*}}index=1
// CHECK: [[item]] = Convert [[value]] declared={type=number flags=[IsExpected]}
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[item]] calleeName="use"
// CHECK-LABEL: function {{*}}name="overPairs"
// CHECK: [[pair]] = ResultAt {{*}}index=1
// CHECK: [[entry]] = Convert [[pair]] declared={type={{*}}Array<{{*}} flags=[IsExpected]}
// CHECK: = IteratorOpen [[entry]] {{*}}isDestructuring
// CHECK-LABEL: function {{*}}name="overPromises"
// CHECK: [[settled]] = ResultAt {{*}}index=1
// CHECK: [[awaited]] = Convert [[settled]] declared={type=number flags=[IsExpected]}
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[awaited]] calleeName="use"

// RUN(CLAIMS): lower
// CLAIMS-NOT: IsClaim

// The name in the head of the loop has no annotation. What a step delivers is expected to be what the checker says of the name, and nothing is claimed of it. For `for await` that is the settled value.
declare function use(value: unknown): void;

export function overArray(items: number[]) {
  for (const item of items) use(item);
}

export async function overPromises(items: Promise<number>[]) {
  for await (const item of items) use(item);
}

export function overPairs(items: Map<string, number>) {
  for (const [key, value] of items) use(key + value);
}

// RUN: lower
// CHECK-LABEL: function {{*}}name="overArray"
// CHECK: = IteratorOpen [[iterable]]
// CHECK: [[value]] = ResultAt {{*}}index=1
// CHECK: handler=
// CHECK-NEXT: [[item]] = Convert [[value]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[item]] calleeName="use"
// CHECK-LABEL: function {{*}}name="overPromises"
// CHECK: [[awaited]] = ResultAt {{*}}index=1
// CHECK: handler=
// CHECK-NEXT: [[settled]] = Convert [[awaited]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, -, [[settled]] calleeName="use"

// An iterable does not say what it holds, so what a step delivers is converted to the type of the name in the head of the loop. For `for await` that is the type of the settled value. The name holds the converted value: nothing converts it again.
declare function use(value: unknown): void;

export function overArray(items: number[]) {
  for (const item of items) use(item);
}

export async function overPromises(items: Promise<number>[]) {
  for await (const item of items) use(item);
}

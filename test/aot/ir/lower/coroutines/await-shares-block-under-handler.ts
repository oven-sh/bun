// RUN: lower
// CHECK-LABEL: function {{*}}name="guarded"
// CHECK: handler=[[handler]](
// CHECK: = Await
// CHECK-NOT: handler=
// CHECK: = Await
// CHECK: [[handler]]({{*}}) role=CatchHandler
// CHECK-NEXT: = CatchValue
// CHECK-LABEL: function {{*}}name="unguarded"
// CHECK-NOT: handler=

declare function use(value: unknown): void;

export async function guarded(first: Promise<number>, second: Promise<number>) {
  try {
    await first;
    await second;
  } catch (error) {
    use(error);
  }
}

export async function unguarded(first: Promise<number>) {
  await first;
}

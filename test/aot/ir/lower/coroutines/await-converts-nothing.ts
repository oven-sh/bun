// RUN: lower
// CHECK-LABEL: function {{*}}name="read"{{*}}IsAsync
// CHECK: [[value]] = Await [[promise]]
// CHECK-NEXT: Return [[value]]

// RUN(AWAITS): lower
// AWAITS-COUNT-1: = Await
// AWAITS-NOT: = Await

// RUN(MODULE): lower
// MODULE-NOT: kind=Module{{*}}IsAsync

// What an `await` takes out of a promise is converted to nothing, whatever the type of the promise says that it holds: nothing is written at the `await`.

export async function read(promise: Promise<number>) {
  return await promise;
}

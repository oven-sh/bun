// RUN: lower
// CHECK-LABEL: function {{*}}name="read"{{*}}IsAsync
// CHECK: [[value]] = Await [[promise]]
// CHECK-NEXT: = Convert [[value]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen

// RUN(AWAITS): lower
// AWAITS-COUNT-1: = Await
// AWAITS-NOT: = Await

// RUN(MODULE): lower
// MODULE-NOT: kind=Module{{*}}IsAsync

export async function read(promise: Promise<number>) {
  return await promise;
}

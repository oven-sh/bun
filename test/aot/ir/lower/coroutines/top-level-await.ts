// RUN: lower
// CHECK: function {{*}}kind=Module{{*}}IsAsync
// CHECK: [[value]] = Await [[promise]]
// CHECK-NEXT: = Convert [[value]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen

// RUN(START): lower
// START-NOT: InitialYield

declare const source: Promise<number>;

export const value = await source;

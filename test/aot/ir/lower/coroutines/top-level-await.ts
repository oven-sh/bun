// RUN: lower
// CHECK: function {{*}}kind=Module{{*}}IsAsync
// CHECK: [[value]] = Await [[promise]]
// CHECK-NEXT: PutModuleVariable [[value]]

// RUN(START): lower
// START-NOT: InitialYield

declare const source: Promise<number>;

export const value = await source;

// RUN: lower
// CHECK: function {{*}}kind=Module
// CHECK: Return

// RUN(FLAGS): lower
// FLAGS-NOT: IsAsync
// FLAGS-NOT: IsSloppy
// FLAGS-NOT: HasThis
// FLAGS-NOT: parameters=

export const a = 1;

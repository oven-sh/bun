// RUN: link
// CHECK: layout [[a]] module=[[entry]] position=
// CHECK: layout [[b]] module=[[entry]] position=
// CHECK-NOT: layout {{*}}module=[[entry]]
// CHECK: data {{*}}root=Object{layout=[[a]]} module=[[entry]]
// CHECK: data {{*}}root=Object{layout=[[b]]} module=[[entry]]

export const a = {};
export const b = {};

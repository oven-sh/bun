// RUN: link
// CHECK: module {{*}}kind=Data{{*}}body=[[body]] data=[[data]]
// CHECK: function [[body]]
// CHECK-NOT: = NewObject
// CHECK: = Data data=[[data]]
// CHECK-NOT: = Data
// CHECK-NOT: = NewObject
// CHECK: = PropGet {{*}}key="name"
// CHECK: PutModuleVariable
// CHECK: Return
// CHECK: data [[data]] root=Object{layout=L{{*}}members=[{key="name" value=String{value="table"}}, {key="size" value=Number{value=2}}, {key="nested" value=Object{layout=L

import table, { name } from "./imports/table.json";

export const both = [table, name];

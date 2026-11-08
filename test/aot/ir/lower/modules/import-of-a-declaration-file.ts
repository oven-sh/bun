// RUN: link
// CHECK: module [[declarations]] path="{{*}}/imports/only-declares.d.ts" displayPath="{{*}}only-declares.d.ts"
// CHECK-NOT: IsLibrary
// CHECK: module {{*}}path="{{*}}/import-of-a-declaration-file.ts"{{*}}requests=[{target=[[declarations]] completes=true}]

import "./imports/only-declares.d.ts";

export const thing: Thing = { n: 1 };

// Neither file says in its text what it is. Each is what its extension says, whether import or require() loads it.
// RUN: link
// CHECK: module [[imported]] path="{{*}}/by-extension/imported.cjs"{{*}}kind=CommonJs
// CHECK: module [[required]] path="{{*}}/by-extension/required.cjs"{{*}}kind=CommonJs
// CHECK: function {{*}}module=[[imported]] kind=CommonJsModule flags=[IsSloppy]
// CHECK: function {{*}}module=[[imported]] {{*}}flags=[IsSloppy, HasThis]
// CHECK: function {{*}}module=[[required]] kind=CommonJsModule flags=[IsSloppy]
// CHECK: function {{*}}module=[[required]] {{*}}flags=[IsSloppy, HasThis]

import { createRequire } from "node:module";
import "./imports/by-extension/imported.cjs";
createRequire(import.meta.url)("./imports/by-extension/required.cjs");

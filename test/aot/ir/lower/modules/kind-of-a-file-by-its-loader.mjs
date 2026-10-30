// Neither file says in its text what it is. The one that import loads is an ES module, as its package has no "type". The one that require() loads is what its extension says.
// RUN: link
// CHECK: module [[imported]] path="{{*}}/by-loader/imported.cjs" displayPath="imports/by-loader/imported.cjs" flags=[KeepsError]
// CHECK: module [[required]] path="{{*}}/by-loader/required.cjs"{{*}}kind=CommonJs
// CHECK: function {{*}}module=[[imported]] kind=Module thisType=
// CHECK: function {{*}}module=[[imported]] {{*}}flags=[HasThis]
// CHECK: function {{*}}module=[[required]] kind=CommonJsModule flags=[IsSloppy]
// CHECK: function {{*}}module=[[required]] {{*}}flags=[IsSloppy, HasThis]

import { createRequire } from "node:module";
import "./imports/by-loader/imported.cjs";
createRequire(import.meta.url)("./imports/by-loader/required.cjs");

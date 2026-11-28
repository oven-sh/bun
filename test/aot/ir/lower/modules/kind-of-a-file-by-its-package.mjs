// Neither file has anything of CommonJS but `__filename`. Both are ES modules, as their package says.
// RUN: link
// CHECK: module [[imported]] path="{{*}}/by-loader/imported.jsx" displayPath="imports/by-loader/imported.jsx" flags=[CachesEvaluationError]
// CHECK: module [[required]] path="{{*}}/by-loader/required.jsx" displayPath="imports/by-loader/required.jsx" flags=
// CHECK: function {{*}}module=[[imported]] kind=Module thisType=
// CHECK: function {{*}}module=[[imported]] {{*}}flags=[HasThis]
// CHECK: function {{*}}module=[[required]] kind=Module thisType=
// CHECK: function {{*}}module=[[required]] {{*}}flags=[HasThis]

import { createRequire } from "node:module";
import "./imports/by-loader/imported.jsx";
createRequire(import.meta.url)("./imports/by-loader/required.jsx");

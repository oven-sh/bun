// source.mjs exports a variable of its own that its import statement fills. The object of front.mjs shows that variable.
// RUN: link
// OPTIONS: builtin-modules
// CHECK: variable [[bun]] name="bun" module=[[source]]
// CHECK: module [[source]] path="{{*}}source.mjs"
// CHECK: module {{*}}front.mjs" {{*}}exports=[{name="bun" variable=[[bun]] isFromStarExport=true}]
// CHECK: PutModuleVariable {{*}}variable=[[bun]]

import * as front from "./imports/bun-exported-again/front.mjs";
console.log(Object.keys(front).join());

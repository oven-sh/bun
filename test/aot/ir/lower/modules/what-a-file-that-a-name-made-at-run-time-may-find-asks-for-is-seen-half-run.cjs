// A load under a name that the build does not follow finds asker.cjs by the text that spells it, at whatever time it runs: here while the body of served.cjs runs.
// So what asker.cjs requires may be seen half run: served.cjs makes its first object ahead of everything else, and no request says that served.cjs completes.
// RUN: link
// CHECK: module [[served]] path="{{*}}/served.cjs"
// CHECK: path="{{*}}/asker.cjs"{{*}}IsFoundByName]{{*}}requests=[{target=[[served]] kind=Require}]
// CHECK: function {{*}}module=[[served]] kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK-NEXT: = NewObject

// FILE: main.cjs
const served = require("./served.cjs");
const asker = require("./asker.cjs");
console.log(asker.seen, typeof served);

// FILE: served.cjs
console.log("./asker.cjs");
require(process.env.MADE_UP_PLUG);
module.exports = function serve() {};

// FILE: asker.cjs
exports.seen = typeof require("./served.cjs");

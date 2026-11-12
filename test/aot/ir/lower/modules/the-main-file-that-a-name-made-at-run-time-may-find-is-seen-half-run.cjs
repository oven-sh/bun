// A load under a name that the build does not follow finds an entry point, the main one too, and the main file still runs while the files below it run.
// So the main file makes its first object ahead of everything else. asker.cjs, which nothing asks for while it runs, is not touched: the request for it says that it completes.
// RUN: link
// CHECK: module [[asker]] path="{{*}}/asker.cjs"
// CHECK: module [[main]] path="{{*}}/main.cjs"{{*}}requests=[{target=[[asker]] kind=Require completes=true}]
// CHECK: function {{*}}module=[[main]] kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK-NEXT: = NewObject

// FILE: main.cjs
const asker = require("./asker.cjs");
module.exports = function serve() {};
console.log(asker.seen);

// FILE: asker.cjs
exports.seen = typeof require(process.argv[1]);

// `const proto = module.exports = { .. }`, as koa/lib/context.js begins: the store that replaces the exports object stands in what a name is born with.
// Nobody can see the object that the body would begin with, so the body does not make it: the exports variable has one store, and what require() hands on is of one layout.
// RUN: link
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: b0():
// CHECK-NEXT: [[method]] = NewClosure
// CHECK-NEXT: [[head]] = NewObject -, [[method]]
// CHECK-NEXT: [[made]] = FinishObject [[head]]
// CHECK-NEXT: PutModuleVariable [[made]]

// FILE: main.cjs
const proto = require("./proto.cjs"); console.log(proto.a(), proto.b);

// FILE: proto.cjs
const proto = module.exports = { a() { return 1; } };
proto.b = 2;

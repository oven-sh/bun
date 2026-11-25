// RUN: link
// CHECK: String string="{{*}}/names.cjs?again"

// FILE: main.mjs
console.log(await import("./names.cjs?again"));

// FILE: names.cjs
exports.name = __filename;

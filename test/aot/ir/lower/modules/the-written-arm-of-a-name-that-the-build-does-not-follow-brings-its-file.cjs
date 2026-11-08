// One arm of the name is known only when the program runs, the other is written. The file that the written arm names is compiled and is an entry point, so the load finds it by its path.
// RUN: link
// CHECK: module [[conf]] path="{{*}}/conf.cjs"
// CHECK: = RequireDynamic
// CHECK: entry {{*}}module=[[conf]]

// FILE: main.cjs
const conf = require(process.env.MADE_UP_CONF || "./conf.cjs");
console.log(conf.name);

// FILE: conf.cjs
exports.name = "default";

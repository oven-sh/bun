var original = module;
eval("module = { exports: 'replaced' }");
console.log("module after eval:", JSON.stringify(module), module === original);
for (var i = 0; i < 2; i++) { console.log("module at the start of iteration " + i + ":", JSON.stringify(module)); eval("module = i"); }
console.log("module after the loop:", module, typeof original.exports);
var load = require;
eval("require = 'no function'");
console.log("require after eval:", require, typeof load);

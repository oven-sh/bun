// The environment of the process, one probe of many. It prints what plain Bun prints.
const vm = require("node:vm");
function read(k) { return process.env[k]; }
console.log(typeof read("HOME"));
new vm.Script(process.argv[2]).runInThisContext();
console.log(read("HOME"));
console.log(typeof process.pid);

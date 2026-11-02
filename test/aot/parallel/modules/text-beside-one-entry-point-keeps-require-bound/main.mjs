// One entry point and a text that the build did not read. The run time answers an import() of the text with an entry point and with no other file, and the one entry point has begun before anything requires it: the require() stays a call of the module.
// STATISTIC: RequireSitesBound >= 1
const { ended } = require("./running.mjs");
console.log("main ends, ended:", ended);
export {};

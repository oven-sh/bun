// Code that the compiler does not see stores a string and then null in `process._maxListeners`: a direct read answers what is there, as getMaxListeners does.
require("node:vm").runInNewContext('p._maxListeners = "2"', { p: process });
let limit = process._maxListeners;
console.log(limit + 1, limit === "2", typeof limit, process.getMaxListeners() === limit);
new Function("p", process.argv[2] ?? "p._maxListeners = null")(process);
limit = process._maxListeners;
console.log(limit === null, limit ?? "default", process.getMaxListeners() === limit);

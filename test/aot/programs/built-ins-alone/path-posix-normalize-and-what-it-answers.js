import path from "node:path";
const result = path.posix.normalize("/a/./b/../c/");
console.log(typeof result, result.length, result);

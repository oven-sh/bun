import path from "node:path";
const result = path.win32.normalize("/a/./b/../c/");
console.log(typeof result, result.length, result);

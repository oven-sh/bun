import path from "node:path";
const result = path.win32.relative("/a/b/c", "/a/d");
console.log(typeof result, result.length, result);

import path from "node:path";
const result = path.posix.relative("/a/b/c", "/a/d");
console.log(typeof result, result.length, result);

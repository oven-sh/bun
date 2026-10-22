import path from "node:path";
const result = path.posix.dirname("/a/b/c.txt");
console.log(typeof result, result.length, result);

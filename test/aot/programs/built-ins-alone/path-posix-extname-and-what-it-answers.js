import path from "node:path";
const result = path.posix.extname("/a/b/c.txt");
console.log(typeof result, result.length, result);

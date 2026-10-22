import path from "node:path";
const result = path.posix.basename("/a/b/c.txt", ".txt");
console.log(typeof result, result.length, result);

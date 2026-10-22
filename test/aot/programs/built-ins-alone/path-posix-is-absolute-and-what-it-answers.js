import path from "node:path";
const result = path.posix.isAbsolute("/a");
console.log(typeof result, result);

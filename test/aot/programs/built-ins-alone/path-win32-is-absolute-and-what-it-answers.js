import path from "node:path";
const result = path.win32.isAbsolute("/a");
console.log(typeof result, result);

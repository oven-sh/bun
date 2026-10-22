import path from "node:path";
const result = path.win32.parse("/a/b/c.txt");
console.log(Object.keys(result).join(), result.root.length, result.dir, result.base, result.ext.length, result.name);

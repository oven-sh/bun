import path from "node:path";
const result = path.win32.dirname("/a/b/c.txt");
console.log(typeof result, result.length, result);

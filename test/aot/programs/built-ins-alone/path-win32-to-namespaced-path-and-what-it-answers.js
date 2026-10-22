import path from "node:path";
const result = path.win32.toNamespacedPath("/a/b");
console.log(typeof result, result.length, result);

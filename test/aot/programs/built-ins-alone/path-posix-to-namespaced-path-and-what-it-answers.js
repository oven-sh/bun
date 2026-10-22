import path from "node:path";
const result = path.posix.toNamespacedPath("/a/b");
console.log(typeof result, result.length, result);

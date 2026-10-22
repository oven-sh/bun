import path from "node:path";
const result = path.posix.resolve("/a", "b", "../c");
console.log(typeof result, result.length, result);

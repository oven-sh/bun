import path from "node:path";
const result = path.win32.resolve("/a", "b", "../c");
console.log(typeof result, result.length, result);

import path from "node:path";
const result = path.posix.join("a", "..", "b", "c.txt");
console.log(typeof result, result.length, result);

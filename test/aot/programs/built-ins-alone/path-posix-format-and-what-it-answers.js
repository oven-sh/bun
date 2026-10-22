import path from "node:path";
const result = path.posix.format({ dir: "/a/b", name: "c", ext: ".txt" });
console.log(typeof result, result.length, result);

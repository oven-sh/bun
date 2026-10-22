import path from "node:path";
const result = path.win32.format({ dir: "/a/b", name: "c", ext: ".txt" });
console.log(typeof result, result.length, result);

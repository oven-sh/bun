// Built ins assorted: module object. It prints what plain Bun prints.
import path from "node:path";
const names = [process.argv[2] ?? "/a/b.txt", "c/d"];
let count = 0;
for (const name of names) if (path.isAbsolute(name)) count += path.basename(name).length;
console.log(count);

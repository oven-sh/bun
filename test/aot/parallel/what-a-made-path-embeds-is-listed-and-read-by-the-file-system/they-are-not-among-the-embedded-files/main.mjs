import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "locales");
for (const file of fs.readdirSync(folder).sort()) console.log(file, require(path.join(folder, file)).hello, fs.readFileSync(path.join(folder, file), "utf8").length);
console.log("embedded files:", Bun.embeddedFiles.length);
process.exit(0);

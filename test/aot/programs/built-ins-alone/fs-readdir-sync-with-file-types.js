import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = fs.readdirSync(folder, { withFileTypes: true });
console.log(result.length, result[0] instanceof fs.Dirent, result[0].name, result[0].isFile(), result[0].isDirectory());
fs.rmSync(folder, { recursive: true });

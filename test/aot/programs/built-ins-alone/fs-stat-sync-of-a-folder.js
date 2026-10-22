import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = fs.statSync(folder);
console.log(result.isFile(), result.isDirectory(), result.isSymbolicLink());
fs.rmSync(folder, { recursive: true });

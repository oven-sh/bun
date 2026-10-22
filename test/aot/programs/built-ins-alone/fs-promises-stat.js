import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = await fs.promises.stat(file);
console.log(result.isFile(), result.isDirectory(), result.size + 1, typeof result.mtimeMs, result.mtime instanceof Date, typeof result.mode);
fs.rmSync(folder, { recursive: true });

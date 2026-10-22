import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = fs.mkdirSync(folder, { recursive: true });
console.log(result === undefined, typeof result);
fs.rmSync(folder, { recursive: true });

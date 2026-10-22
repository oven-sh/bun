import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = fs.readFileSync(file, "utf8");
console.log(typeof result, result.length, result);
fs.rmSync(folder, { recursive: true });

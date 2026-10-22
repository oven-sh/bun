import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
console.log(fs.existsSync(file), fs.existsSync(join(folder, "missing.txt")), fs.existsSync(undefined));
fs.rmSync(folder, { recursive: true });

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
console.log(await fs.promises.exists(file), await fs.promises.exists(join(folder, "missing.txt")));
fs.rmSync(folder, { recursive: true });

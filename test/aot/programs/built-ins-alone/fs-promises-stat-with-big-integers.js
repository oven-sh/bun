import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = await fs.promises.stat(file, { bigint: true });
console.log(typeof result.size, result.size + 1n, typeof result.mtimeNs);
fs.rmSync(folder, { recursive: true });

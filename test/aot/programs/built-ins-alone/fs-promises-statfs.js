import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = await fs.promises.statfs(folder);
console.log(typeof result.bsize, typeof result.blocks, typeof result.type);
fs.rmSync(folder, { recursive: true });

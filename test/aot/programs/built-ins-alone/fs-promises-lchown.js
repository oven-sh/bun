import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const result = await fs.promises.lchown(file, process.getuid(), process.getgid());
console.log(result === undefined);
fs.rmSync(folder, { recursive: true });

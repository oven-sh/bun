import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
try {
  fs.accessSync(join(folder, "missing.txt"));
} catch (error) {
  console.log(error instanceof Error, error.code, typeof error.errno, error.syscall, typeof error.path, typeof error.message);
}
fs.rmSync(folder, { recursive: true });

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
console.log(fs.realpathSync.native(file).endsWith("file.txt"));
fs.realpath.native(file, (error, result) => {
  console.log(error === null, result.endsWith("file.txt"));
  fs.rmSync(folder, { recursive: true });
});

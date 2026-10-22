import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.symlinkSync(file, join(folder, "link.txt"));
fs.readlink(join(folder, "link.txt"), function (error, result) {
  console.log(error === null, arguments.length);
  console.log(typeof result, result === file);
  fs.rmSync(folder, { recursive: true });
});

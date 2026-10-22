import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.realpath(join(folder, ".", "file.txt"), function (error, result) {
  console.log(error === null, arguments.length);
  console.log(typeof result, result.endsWith("file.txt"));
  fs.rmSync(folder, { recursive: true });
});

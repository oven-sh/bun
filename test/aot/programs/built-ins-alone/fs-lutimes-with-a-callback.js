import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.lutimes(file, 1, 2, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  console.log(fs.lstatSync(file).mtimeMs);
  fs.rmSync(folder, { recursive: true });
});

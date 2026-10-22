import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const descriptor = fs.openSync(file, "r+");
fs.futimes(descriptor, 1, 2, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  fs.closeSync(descriptor);
  console.log(fs.statSync(file).mtimeMs);
  fs.rmSync(folder, { recursive: true });
});

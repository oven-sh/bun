import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const descriptor = fs.openSync(file, "r+");
fs.fchmod(descriptor, 0o600, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  fs.closeSync(descriptor);
  fs.rmSync(folder, { recursive: true });
});

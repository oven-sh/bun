import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const descriptor = fs.openSync(file, "r+");
const parts = [Buffer.alloc(2), Buffer.alloc(2)];
fs.readv(descriptor, parts, 0, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(typeof result, result + 1, parts[1].toString());
  fs.closeSync(descriptor);
  fs.rmSync(folder, { recursive: true });
});

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const descriptor = fs.openSync(file, "r+");
fs.writev(descriptor, [Buffer.from("H"), Buffer.from("E")], 0, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(typeof result, result + 1);
  fs.closeSync(descriptor);
  console.log(fs.readFileSync(file, "utf8"));
  fs.rmSync(folder, { recursive: true });
});

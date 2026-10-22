import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.copyFile(file, join(folder, "copy.txt"), function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  console.log(fs.readFileSync(join(folder, "copy.txt"), "utf8").length);
  fs.rmSync(folder, { recursive: true });
});

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.link(file, join(folder, "link.txt"), function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  console.log(fs.statSync(file).nlink + 1);
  fs.rmSync(folder, { recursive: true });
});

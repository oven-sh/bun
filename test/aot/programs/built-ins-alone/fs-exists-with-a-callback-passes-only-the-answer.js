import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.exists(file, function (result) {
  console.log(result, arguments.length);
  fs.rmSync(folder, { recursive: true });
});

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.mkdtemp(join(folder, "made-"), function (error, result) {
  console.log(error === null, arguments.length);
  console.log(typeof result, result.length > folder.length, fs.existsSync(result));
  fs.rmSync(folder, { recursive: true });
});

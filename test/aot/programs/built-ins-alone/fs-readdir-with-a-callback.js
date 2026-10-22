import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.readdir(folder, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0], result[1] === undefined);
  fs.rmSync(folder, { recursive: true });
});

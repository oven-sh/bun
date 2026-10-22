import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
const empty = join(folder, "empty");
fs.mkdirSync(empty);
fs.readdir(empty, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(Array.isArray(result), result.length, result[0] === undefined);
  fs.rmSync(folder, { recursive: true });
});

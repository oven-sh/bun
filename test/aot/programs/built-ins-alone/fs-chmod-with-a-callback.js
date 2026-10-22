import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.chmod(file, 0o600, function (error, result) {
  console.log(error === null, arguments.length);
  console.log(result === undefined);
  console.log((fs.statSync(file).mode & 0o777).toString(8));
  fs.rmSync(folder, { recursive: true });
});

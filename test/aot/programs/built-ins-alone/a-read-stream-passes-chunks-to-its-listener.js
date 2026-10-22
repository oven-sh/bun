import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));
const file = join(folder, "file.txt");
fs.writeFileSync(file, "hello");
fs.createReadStream(file, { encoding: "utf8" })
  .on("data", chunk => console.log(typeof chunk, chunk.length))
  .on("close", () => {
    console.log("closed");
    fs.rmSync(folder, { recursive: true });
  });

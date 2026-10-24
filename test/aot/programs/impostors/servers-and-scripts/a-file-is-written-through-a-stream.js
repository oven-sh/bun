import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "write-"));
const file = path.join(folder, "text.txt");
const stream = fs.createWriteStream(file);
stream.write("first ");
stream.end("second", () => {
  console.log(fs.readFileSync(file, "utf8"), stream.bytesWritten);
  fs.rmSync(folder, { recursive: true });
});

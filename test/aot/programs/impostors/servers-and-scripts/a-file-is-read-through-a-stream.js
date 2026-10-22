import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "read-"));
const file = path.join(folder, "text.txt");
fs.writeFileSync(file, "some text");
let text = "";
for await (const chunk of fs.createReadStream(file, { encoding: "utf8", highWaterMark: 4 })) text += chunk + "|";
console.log(text);
fs.rmSync(folder, { recursive: true });

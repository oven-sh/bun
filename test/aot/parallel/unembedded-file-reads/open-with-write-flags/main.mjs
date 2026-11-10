// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const file = new URL("./data.txt", import.meta.url);
try {
  fs.closeSync(fs.openSync(file, fs.constants.O_RDWR));
  console.log("opened");
} catch {
  console.log("not opened");
}
try {
  fs.closeSync(fs.openSync(file, fs.constants.O_RDONLY | Number(process.argv[2] ?? fs.constants.O_RDWR)));
  console.log("opened");
} catch {
  console.log("not opened");
}

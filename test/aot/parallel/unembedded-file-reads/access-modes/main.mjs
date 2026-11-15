// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const at = new URL("./data.txt", import.meta.url);
for (const mode of ["R_OK", "W_OK"]) console.log(mode, typeof fs.constants[mode]);
try {
  fs.accessSync(at, fs.constants.R_OK);
  console.log("readable");
} catch (error) {
  console.log("caught", error.code);
}
try {
  fs.accessSync(at, fs.constants.W_OK);
  console.log("writable");
} catch (error) {
  console.log("caught", error.code);
}

// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { join } from "node:path";
const file = Bun.file(join(import.meta.dir, "data.txt"));
try {
  console.log("read", JSON.stringify(await file.text()));
} catch (error) {
  console.log("caught", error.code);
}

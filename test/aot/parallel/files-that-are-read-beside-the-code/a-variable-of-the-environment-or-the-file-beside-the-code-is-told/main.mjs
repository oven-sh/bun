// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  console.log("read", JSON.stringify(String(readFileSync(process.env.NO_SUCH_VARIABLE_OF_THIS_TEST || join(import.meta.dirname, "data.txt"), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}

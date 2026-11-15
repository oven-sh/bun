// What is awaited may be rejected, so the path that the handler sets is read behind it.
// Reference: bun build --compile
// Build prints: 3 x warn: TS100098: This reads "kept.txt", but the executable has no file at that path. Embed it with --asset kept.txt
// Build prints: 3 x warn: TS100098: This reads "set.txt", but the executable has no file at that path. Embed it with --asset set.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
const rejects = async () => { throw new Error("rejected"); };
let rejected = join(import.meta.dirname, "kept.txt");
try {
  await rejects();
} catch {
  rejected = join(import.meta.dirname, "set.txt");
}
try {
  console.log(readFileSync(rejected, "utf8"));
} catch (error) {
  console.log(error.code);
}
let operand = join(import.meta.dirname, "kept.txt");
try {
  [await rejects()];
} catch {
  operand = join(import.meta.dirname, "set.txt");
}
try {
  console.log(readFileSync(operand, "utf8"));
} catch (error) {
  console.log(error.code);
}
let walked = join(import.meta.dirname, "kept.txt");
try {
  for await (const it of rejects) break;
} catch {
  walked = join(import.meta.dirname, "set.txt");
}
try {
  console.log(readFileSync(walked, "utf8"));
} catch (error) {
  console.log(error.code);
}

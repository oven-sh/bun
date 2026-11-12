// The build decides behind the compiler whether the executable holds a file that a computed import found. A bun-ignore comment above or behind a read of one silences its TS100098, as it silences the TS100098 that the compiler decides for note.txt.
// Build prints: 0 x warn: TS100098: This reads "info/above.json", but the executable has no file at that path. Embed it with --asset info/above.json
// Build prints: 0 x warn: TS100098: This reads "info/behind.json", but the executable has no file at that path. Embed it with --asset info/behind.json
// Build prints: 1 x warn: TS100098: This reads "info/bare.json", but the executable has no file at that path. Embed it with --asset info/bare.json
// Build prints: 1 x warn: TS100098: This reads "info/other.json", but the executable has no file at that path. Embed it with --asset info/other.json
// Build prints: 0 x warn: TS100098: This reads "info/note.txt", but the executable has no file at that path. Embed it with --asset info/note.txt
// Build prints: 1 x warn: TS100073: This comment silences nothing: the build reports no TS100165 on the line that it applies to
// Build prints: 0 x warn: TS100073: This comment silences nothing: the build reports no TS100098 on the line that it applies to
import fs from "node:fs";
const stem = process.argv[2] ?? "above";
console.log("required", import.meta.require("./info/" + stem + ".json").commit);
const found = [];
try {
  // bun-ignore TS100098
  found.push(fs.readFileSync(new URL("./info/above.json", import.meta.url), "utf8"));
} catch (error) {
  found.push(error.code);
}
try {
  found.push(fs.readFileSync(new URL("./info/behind.json", import.meta.url), "utf8")); // bun-ignore TS100098
} catch (error) {
  found.push(error.code);
}
try {
  found.push(fs.readFileSync(new URL("./info/bare.json", import.meta.url), "utf8"));
} catch (error) {
  found.push(error.code);
}
try {
  // bun-ignore TS100165
  found.push(fs.readFileSync(new URL("./info/other.json", import.meta.url), "utf8"));
} catch (error) {
  found.push(error.code);
}
try {
  // bun-ignore TS100098
  found.push(fs.readFileSync(new URL("./info/note.txt", import.meta.url), "utf8"));
} catch (error) {
  found.push(error.code);
}
console.log(found.join(" "));
/* Output:
required above
ENOENT ENOENT ENOENT ENOENT ENOENT
*/

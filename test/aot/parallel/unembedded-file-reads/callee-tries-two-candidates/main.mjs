// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "notes.json", but the executable has no file at that path. Embed it with --asset notes.json
// Build prints: 0 x warn: TS100098: This reads "../notes.json", but the executable has no file at that path. Embed it with --asset ../notes.json
import { readNotes } from "./reader.mjs";
console.log("read", JSON.stringify(readNotes(import.meta.url)));

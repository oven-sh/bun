import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
const lineOf = text => text.split("\n").filter(line => line.includes("kFs")).map(line => line.trim().slice(0, 24)).join(" | ") || "no line";
const stream = createWriteStream(join(mkdtempSync(join(tmpdir(), "a-write-stream-")), "text.txt"));
console.log(lineOf(inspect(stream, { depth: +(process.argv[2] ?? 0) })));
stream.end();

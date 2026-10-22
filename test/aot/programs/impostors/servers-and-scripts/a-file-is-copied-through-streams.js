import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "copy-"));
const source = path.join(folder, "source.txt");
const target = path.join(folder, "target.txt");
fs.writeFileSync(source, Array.from({ length: 5000 }, (_, index) => "row " + index).join("\n"));

let chunks = 0;
let bytes = 0;
const upper = new Transform({
  transform(chunk, encoding, done) {
    chunks++;
    bytes += chunk.length;
    done(null, chunk.toString().toUpperCase());
  },
  flush(done) {
    this.push("\nEND");
    done();
  },
});

await pipeline(fs.createReadStream(source, { highWaterMark: 4096 }), upper, fs.createWriteStream(target));
const copied = fs.readFileSync(target, "utf8");
console.log(chunks, bytes, copied.length, copied.slice(0, 11), copied.slice(-12));

try {
  await pipeline(fs.createReadStream(path.join(folder, "missing.txt")), fs.createWriteStream(target));
} catch (error) {
  console.log("pipeline failed:", error.code);
}

const part = fs.createReadStream(source, { start: 4, end: 12, encoding: "utf8" });
let text = "";
for await (const piece of part) text += piece;
console.log(JSON.stringify(text));
fs.rmSync(folder, { recursive: true });

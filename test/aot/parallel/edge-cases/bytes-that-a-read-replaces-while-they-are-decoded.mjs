// TextDecoder.decode() stays inside the text that it allocates while fs.read() replaces its bytes with longer or shorter text.
import { openSync, read, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const texts = [Buffer.from("é" + "€".repeat(20_000)), Buffer.from("é" + "a".repeat(60_000))];
const files = texts.map((text, i) => {
  const path = join(tmpdir(), "bytes-that-a-read-replaces-" + process.pid + "-" + i);
  writeFileSync(path, text);
  const file = openSync(path);
  unlinkSync(path);
  return file;
});
const bytes = new Uint8Array(texts[0].length);
const decoder = new TextDecoder();
const deadline = performance.now() + 500;
let isInRange = true;
for (let turn = 0; performance.now() < deadline; turn ^= 1) {
  bytes.set(texts[turn]);
  const { promise, resolve, reject } = Promise.withResolvers();
  read(files[turn ^ 1], bytes, 0, bytes.length, 0, error => (error ? reject(error) : resolve()));
  const { length } = decoder.decode(bytes);
  isInRange &&= length > 0 && length <= bytes.length;
  await promise;
}
console.log(isInRange);

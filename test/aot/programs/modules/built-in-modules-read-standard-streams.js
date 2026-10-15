// Built-in modules read process.stdout, stderr or stdin on their own, and native code then loads more modules. Those are compiled too.
import assert from "node:assert";
import { executionAsyncResource } from "node:async_hooks";
import { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
try {
  assert.strictEqual(1, 2);
} catch (error) {
  console.log(error.message.split("\n")[0]);
}
console.log(typeof styleText("red", "text"));
const chunks = [];
const sink = new Writable({ write(chunk, encoding, done) { chunks.push(String(chunk)); done(); } });
await new Promise(finished => Readable.from(["a", "b"]).pipe(sink).on("finish", finished));
console.log(chunks.join());
console.log(typeof executionAsyncResource());

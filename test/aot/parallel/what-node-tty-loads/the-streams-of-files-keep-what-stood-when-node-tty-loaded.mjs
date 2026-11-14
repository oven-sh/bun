// node:tty loads the streams of files while it loads, and those keep read() of node:fs and read() of a file handle as they stand then. A program that lays its own
// functions over them afterwards: the stream of a handle does not call the read() of node:fs that came later, and sees that the read() of the handle is no longer the one it kept.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("node:tty");
const fs = require("node:fs");
const path = require("node:path");
const folder = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "made-up-"));
const file = path.join(folder, "a.txt");
fs.writeFileSync(file, "hello");
const calls = { ofModule: 0, ofHandle: 0 };
const readOfModule = fs.read;
fs.read = function (...given) {
  calls.ofModule++;
  return readOfModule.apply(this, given);
};
async function readThrough() {
  const handle = await fs.promises.open(file);
  let text = "";
  for await (const chunk of handle.createReadStream()) text += chunk;
  return text;
}
console.log(await readThrough(), calls.ofModule > 0, calls.ofHandle > 0);
const opened = await fs.promises.open(file);
const prototype = Object.getPrototypeOf(opened);
await opened.close();
const readOfHandle = prototype.read;
prototype.read = function (...given) {
  calls.ofHandle++;
  return readOfHandle.apply(this, given);
};
console.log(await readThrough(), calls.ofModule > 0, calls.ofHandle > 0);
fs.rmSync(folder, { recursive: true });
process.exit(0);

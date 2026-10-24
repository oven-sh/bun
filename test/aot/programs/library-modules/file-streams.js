// fs.createWriteStream and fs.createReadStream alone: write and finish, read whole, read a range, small pieces, append, pipe from one to the other, a file that is not there, a descriptor that is passed in, and the streams of a FileHandle.
import fs from "node:fs";
import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "library-modules-"));
const at = name => path.join(folder, name);

const out = fs.createWriteStream(at("a.txt"));
out.write("alpha ");
out.write(Buffer.from("beta "));
out.end("gamma");
await once(out, "finish");
console.log(out.bytesWritten, path.basename(out.path), fs.readFileSync(at("a.txt"), "utf8"));

async function read(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part.toString());
  return parts;
}
console.log((await read(fs.createReadStream(at("a.txt")))).join("|"));
console.log((await read(fs.createReadStream(at("a.txt"), { start: 6, end: 9 }))).join("|"));
console.log((await read(fs.createReadStream(at("a.txt"), { highWaterMark: 6, encoding: "utf8" }))).join("|"));

const more = fs.createWriteStream(at("a.txt"), { flags: "a" });
more.end(" delta");
await once(more, "close");
const copy = fs.createWriteStream(at("b.txt"));
fs.createReadStream(at("a.txt")).pipe(copy);
await once(copy, "finish");
console.log(fs.readFileSync(at("b.txt"), "utf8"));

console.log(await once(fs.createReadStream(at("missing")), "error").then(([error]) => [error.code, error.syscall].join()));
console.log(await once(fs.createWriteStream(at("no/such/folder.txt")), "error").then(([error]) => error.code));

const descriptor = fs.openSync(at("a.txt"), "r");
console.log((await read(fs.createReadStream(null, { fd: descriptor, end: 4 }))).join("|"));
const opened = fs.createReadStream(at("a.txt"));
const [whenOpen, whenReady] = await Promise.all([once(opened, "open"), once(opened, "ready")]);
console.log(typeof whenOpen[0], whenReady.length);
opened.destroy();

const handle = await open(at("c.txt"), "w+");
const viaHandle = handle.createWriteStream();
viaHandle.end("through a handle");
await once(viaHandle, "close");
console.log(fs.readFileSync(at("c.txt"), "utf8"));
fs.rmSync(folder, { recursive: true });

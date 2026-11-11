// A stream on a FileHandle calls back from a job: a microtask that its callback queues runs before a process.nextTick that it queues. A stream on a path calls back outside one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-streams-"));
const at = name => path.join(dir, name);
fs.writeFileSync(at("in"), "one\ntwo\n");

async function order(start) {
  const seen = [];
  const stream = await start(() => {
    seen.push("callback");
    process.nextTick(() => seen.push("nextTick"));
    queueMicrotask(() => seen.push("microtask"));
  });
  await new Promise(done => stream.on("close", done));
  return seen.join(" ");
}
function written(stream, callback, chunks) {
  for (let i = 1; i < chunks; i++) stream.write("a");
  stream.write("b", callback);
  stream.end();
  return stream;
}

const reader = () => fs.promises.open(at("in"), "r");
const writer = () => fs.promises.open(at("out"), "w");
const rows = {
  "handle, data": async callback => (await reader()).createReadStream().once("data", callback),
  "handle, data, by fs.createReadStream": async callback =>
    fs.createReadStream(null, { fd: await reader() }).once("data", callback),
  "handle, line": async callback => (await reader()).readLines().once("line", callback),
  "handle, one chunk": async callback => written((await writer()).createWriteStream(), callback, 1),
  "handle, two chunks": async callback => written((await writer()).createWriteStream(), callback, 2),
  "handle, a write that fails": async callback =>
    written((await reader()).createWriteStream(), callback, 1).on("error", error => console.log(typeof error.code)),
  "path, data": async callback => fs.createReadStream(at("in")).once("data", callback),
  "path, one chunk": async callback => written(fs.createWriteStream(at("out")), callback, 1),
  "descriptor, data": async callback =>
    fs.createReadStream(null, { fd: fs.openSync(at("in"), "r") }).once("data", callback),
};
for (const name in rows) console.log(name + ": " + (await order(rows[name])));
console.log(fs.readFileSync(at("out"), "utf8"));
fs.rmSync(dir, { recursive: true });

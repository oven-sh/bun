// Under `bun <file>` a closure keeps every captured variable of its scope alive, here `handle`, which only the other closure names. A FileHandle that is collected closes its descriptor and raises ERR_INVALID_STATE (src/js/node/fs.promises.ts).
// Todo: Plain Bun prints `read 4`. The executable prints `uncaught ERR_INVALID_STATE` and `threw EBADF`, as that of the compiler before the rewrite did: an object that acts when it is collected is let go like every other object that no kept closure names.
import { readSync } from "node:fs";
import { open } from "node:fs/promises";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on("uncaughtException", error => console.log("uncaught", error.code));
async function hold(path) {
  const handle = await open(path);
  const fd = handle.fd;
  const close = () => handle.close();
  void close;
  return () => readSync(fd, Buffer.alloc(4));
}
const read = await hold(process.execPath);
for (let round = 0; round < 10; round++) {
  Bun.gc(true);
  await sleep(5);
}
try {
  console.log("read", read());
} catch (error) {
  console.log("threw", error.code);
}

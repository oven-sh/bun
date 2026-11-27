import { createReadStream } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
function watch(holder, report) {
  const { held } = holder;
  const kept = held.statSync;
  let seen = "not called";
  held.statSync = function (...args) {
    seen = String(this === held);
    return kept(...args);
  };
  const server = net.createServer().listen(
    { path: path.join(os.tmpdir(), "listens-" + process.pid + ".sock"), readableAll: true },
    () => {
      server.close();
      report(seen);
    },
  );
}
const stream = createReadStream(null, { fd: 0, autoClose: false });
const key = Object.getOwnPropertySymbols(stream).find(it => it.description === "kFs");
watch({ held: stream[key] }, seen => console.log(seen));

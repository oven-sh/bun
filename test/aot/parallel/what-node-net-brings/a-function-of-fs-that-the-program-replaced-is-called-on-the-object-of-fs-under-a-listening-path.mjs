// The same where the program takes the object by an import, and for the two calls under `readableAll`.
import fs from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
for (const name of ["statSync", "chmodSync"]) {
  const kept = fs[name];
  fs[name] = function (...given) {
    console.log(name, this === fs);
    return kept.apply(fs, given);
  };
}
const path = tmpdir() + "/made-up-" + process.pid + ".sock";
const server = net.createServer();
server.listen({ path, readableAll: true, writableAll: true }, () => server.close(() => console.log("closed")));

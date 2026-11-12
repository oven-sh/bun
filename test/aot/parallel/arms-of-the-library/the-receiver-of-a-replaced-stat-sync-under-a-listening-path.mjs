// src/js/node/net.ts calls statSync and chmodSync by their names only where the compiled program never holds the module's object. This one does.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
const real = fs.statSync;
let seen = "not called",
  reads = 0;
const chmodSync = fs.chmodSync;
fs.statSync = function (...args) {
  seen = String(this === fs);
  return real.apply(fs, args);
};
Object.defineProperty(fs, "chmodSync", {
  configurable: true,
  get() {
    reads++;
    return chmodSync;
  },
});
const server = net
  .createServer()
  .listen({ path: path.join(os.tmpdir(), "p11-" + process.pid + ".sock"), readableAll: true }, () => {
    server.close();
    console.log(`${seen} ${reads > 0}`);
  });

import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
const holder = process.stdout;
const lister = new EventEmitter();
lister._events = holder;
lister._eventsCount = 1;
const key = lister.eventNames().find(it => typeof it === "symbol" && it.description === "kFs");
const held = holder[key];
const kept = held.statSync;
let seen = "not called";
held.statSync = function (path) {
  seen = String(this === held);
  return kept(path);
};
const folder = mkdtempSync(join(tmpdir(), "a-listening-path-"));
const server = net.createServer();
const end = () => rmSync(folder, { recursive: true });
server.on("error", error => {
  console.log("an error event:", seen, error.code);
  console.log(error.message);
  end();
});
server.listen({ path: join(folder, "made.sock"), readableAll: true }, () => {
  console.log("listens", seen);
  server.close(end);
});

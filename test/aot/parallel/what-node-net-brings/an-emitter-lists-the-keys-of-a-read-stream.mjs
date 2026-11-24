import { createReadStream } from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
const holder = createReadStream(null, { fd: 0, autoClose: false });
const lister = new EventEmitter();
lister._events = holder;
lister._eventsCount = 1;
const key = lister.eventNames().find(it => typeof it === "symbol" && it.description === "kFs");
const held = holder[key];
const kept = held.fstatSync;
let seen = "not called";
held.fstatSync = function (fd) {
  seen = String(this === held);
  return kept(fd);
};
try {
  new net.Socket({ fd: +(process.argv[2] ?? 987), writable: true });
} catch (error) {
  console.log(seen, error.code);
}

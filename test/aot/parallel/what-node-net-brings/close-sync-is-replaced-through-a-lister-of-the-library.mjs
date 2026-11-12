import net from "node:net";
import { openSync } from "node:fs";
import { EventEmitter } from "node:events";
const holder = process.stdout;
const lister = new EventEmitter();
lister._events = holder;
lister._eventsCount = 1;
const key = lister.eventNames().find(it => typeof it === "symbol" && it.description === "kFs");
const held = holder[key];
const kept = held.closeSync;
let seen = "not called";
held.closeSync = function (fd) {
  seen = String(this === held);
  return kept(fd);
};
const socket = new net.Socket({ fd: openSync("/dev/null", "w"), writable: true });
socket.on("error", error => {
  console.log("an error event:", seen, error.code);
  console.log(error.message);
});
socket.on("close", () => console.log("closed", seen));
try {
  socket.destroy();
} catch (error) {
  console.log("destroy() threw:", seen, error.message);
}

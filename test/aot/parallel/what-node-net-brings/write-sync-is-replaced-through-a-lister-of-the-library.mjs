import net from "node:net";
import { openSync } from "node:fs";
import { EventEmitter } from "node:events";
const holder = process.stdout;
const lister = new EventEmitter();
lister._events = holder;
lister._eventsCount = 1;
const key = lister.eventNames().find(it => typeof it === "symbol" && it.description === "kFs");
const held = holder[key];
const kept = held.writeSync;
let seen = "not called";
held.writeSync = function (...args) {
  seen = String(this === held);
  return kept(...args);
};
const socket = new net.Socket({ fd: openSync("/dev/null", "w"), writable: true });
socket.on("error", error => {
  console.log("an error event:", seen, error.code);
  console.log(error.message);
});
socket.write("text", error => console.log("the callback:", seen, error ? error.code : "no error"));

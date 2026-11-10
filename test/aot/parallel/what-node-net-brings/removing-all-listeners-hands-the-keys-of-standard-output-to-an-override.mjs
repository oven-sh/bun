import net from "node:net";
import { EventEmitter } from "node:events";
const holder = process.stdout;
const keys = [];
class Lister extends EventEmitter {
  removeAllListeners(...names) {
    if (!names.length) return super.removeAllListeners();
    keys.push(names[0]);
    return this;
  }
}
const lister = new Lister();
lister._events = holder;
lister.removeAllListeners();
const key = keys.find(it => typeof it === "symbol" && it.description === "kFs");
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

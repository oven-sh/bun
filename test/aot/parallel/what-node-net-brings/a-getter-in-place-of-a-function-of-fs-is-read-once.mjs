import net from "node:net";
import { EventEmitter } from "node:events";
const holder = process.stdout;
const lister = new EventEmitter();
lister._events = holder;
lister._eventsCount = 1;
const key = lister.eventNames().find(it => typeof it === "symbol" && it.description === "kFs");
const held = holder[key];
const kept = held.fstatSync;
let reads = 0;
Object.defineProperty(held, "fstatSync", {
  configurable: true,
  get() {
    reads++;
    return kept;
  },
});
try {
  new net.Socket({ fd: +(process.argv[2] ?? 987), writable: true });
} catch (error) {
  console.log(reads, error.code);
}

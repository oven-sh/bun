import { group } from "mitata";
import EventEmitterNative from "node:events";

export const implementations = [
  {
    EventEmitter: EventEmitterNative,
    name: process.isBun ? (EventEmitterNative.init ? "bun" : "C++") : "node:events",
    monkey: true,
  },
  // { EventEmitter: EventEmitter3, name: "EventEmitter3" },
].filter(Boolean);

for (const impl of implementations) {
  impl.EventEmitter?.setMaxListeners?.(Infinity);
}

export function groupForEmitter(name, cb) {
  if (implementations.length === 1) {
    return cb({
      ...implementations[0],
      name: `${name}: ${implementations[0].name}`,
    });
  } else {
    return group(name, () => {
      for (let impl of implementations) {
        cb(impl);
      }
    });
  }
}

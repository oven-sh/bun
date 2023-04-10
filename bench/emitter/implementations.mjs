import EventEmitter3 from "eventemitter3";
import EventEmitterNative from "node:events";
import NewImpl1 from "../../src/bun.js/events.exports.mjs";
import NewImpl2 from "../../src/bun.js/events_map.mjs";

export const implementations = [
  { impl: EventEmitterNative, name: process.isBun ? "node:events (bun C++)" : "node:events", monkey: true },
  // { impl: EventEmitter3, name: "EventEmitter3" },
  { impl: NewImpl1, name: "new(Object)", monkey: true },
  { impl: NewImpl2, name: "new(Map)", monkey: true },
];

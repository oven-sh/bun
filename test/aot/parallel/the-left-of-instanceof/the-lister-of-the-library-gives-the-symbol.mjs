import { EventEmitter } from "node:events";
const keys = EventEmitter.prototype.eventNames.call({ _eventsCount: 1, _events: Object.getPrototypeOf(() => {}) });
const hook = keys[keys.length - 1];
const kind = { [hook](value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } };
console.log("SAID", process instanceof kind);

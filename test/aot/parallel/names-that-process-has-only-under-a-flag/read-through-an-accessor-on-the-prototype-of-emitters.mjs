import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "noDeprecation", { get() { return typeof this.allowedNodeEnvironmentFlags.has; } });
console.log(process.noDeprecation);

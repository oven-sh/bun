import { EventEmitter } from "node:events";
Object.defineProperty(EventEmitter.prototype, "traceDeprecation", { get() { return typeof this.allowedNodeEnvironmentFlags.has; } });
const { traceDeprecation } = process;
console.log(traceDeprecation);

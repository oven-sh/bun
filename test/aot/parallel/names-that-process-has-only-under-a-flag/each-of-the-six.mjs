import { EventEmitter } from "node:events";
const names = ["noDeprecation", "noProcessWarnings", "pendingDeprecation", "throwDeprecation", "traceDeprecation", "traceProcessWarnings"];
for (const name of names) Object.defineProperty(EventEmitter.prototype, name, { get() { return name + " " + typeof this.allowedNodeEnvironmentFlags.has; } });
console.log(process.noDeprecation, process.noProcessWarnings, process.pendingDeprecation, process.throwDeprecation, process.traceDeprecation, process.traceProcessWarnings);

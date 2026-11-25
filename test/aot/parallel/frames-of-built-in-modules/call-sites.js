// Under: --sourcemap=external: a call site of a built-in module has its name and its file
// Under: --obfuscate: the same
const { EventEmitter } = require("node:events");

Error.prepareStackTrace = (error, sites) =>
  sites
    .filter(site => String(site.getFileName()).startsWith("node:"))
    .map(site => [site.getFunctionName(), site.getFileName(), site.isNative(), typeof site.getLineNumber(), String(site).replace(/:\d+:\d+/, "")].join(" "));
const emitter = new EventEmitter();
emitter.on("stack", () => console.log(new Error("from a listener").stack));
emitter.emit("stack");
const captured = {};
emitter.on("captured", () => Error.captureStackTrace(captured));
emitter.emit("captured");
console.log(captured.stack);

const which = process.argv[2];
process.on("unhandledRejection", (e) => {
  if (which === "tick") process.nextTick(() => process.exit(1));
  else if (which === "micro") queueMicrotask(() => process.exit(1));
  else if (which === "promise") Promise.resolve().then(() => process.exit(1));
  else if (which === "immediate") setImmediate(() => process.exit(1));
  else if (which === "timeout") setTimeout(() => process.exit(1), 0);
  else if (which === "fswrite") require("fs").createWriteStream("/dev/null").write("x", () => process.exit(1));
  else if (which === "passthrough") { const { PassThrough } = require("stream"); new PassThrough().write("x", () => process.exit(1)); }
});
Promise.reject(new Error("boom"));

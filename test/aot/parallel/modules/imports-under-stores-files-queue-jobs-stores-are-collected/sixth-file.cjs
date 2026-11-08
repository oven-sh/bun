see("sixth-file");
queueMicrotask(() => see("job of sixth-file"));
module.exports = {};
throw new Error("sixth-file throws");

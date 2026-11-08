see("second-file");
queueMicrotask(() => see("job of second-file"));
module.exports = {};
throw new Error("second-file throws");

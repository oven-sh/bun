see("fourth-file");
queueMicrotask(() => see("job of fourth-file"));
module.exports = {};
throw new Error("fourth-file throws");

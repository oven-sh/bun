globalThis.log.push("throws-b");
exports.value = 2;
throw new Error("thrown by a file");

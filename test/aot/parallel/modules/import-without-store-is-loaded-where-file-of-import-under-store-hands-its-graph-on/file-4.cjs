see("tick under X: file");
store.run("X", () => process.nextTick(() => see("tick under X: tick of file")));
see("tick under X: file behind the trigger");
exports.name = "file-4";

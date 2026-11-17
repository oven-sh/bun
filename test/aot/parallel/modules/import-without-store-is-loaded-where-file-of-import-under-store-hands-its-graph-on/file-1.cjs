see("tick: file");
process.nextTick(() => see("tick: tick of file"));
see("tick: file behind the trigger");
exports.name = "file-1";

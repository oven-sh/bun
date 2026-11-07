store.enterWith("entered by the file");
see("enters-queues");
exports.name = "a" + process.argv.length;
queueMicrotask(() => see("job of enters-queues"));

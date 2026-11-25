const went = process.stdout.write("much\n");
if (!went) process.stdout.once("drain", () => console.log("drained"));
process.stdout.on("error", () => {});
console.log(typeof went, process.stdout.listenerCount("error"), process.stdout.writable);

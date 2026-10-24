// process.emitWarning emits the event on the next tick, and the listener that prints it has been on process from the start.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
process.on("warning", warning => console.log("listener: " + warning.name + ": " + warning.message + " " + warning.code));
process.emitWarning("first", "CustomWarning", "CODE1");
process.emitWarning(new Error("second"));
console.log(process.listenerCount("warning"));

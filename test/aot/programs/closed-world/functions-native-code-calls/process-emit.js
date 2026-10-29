// A program that emits the event itself, or calls the listener it finds on process, reaches the function that prints without a tick.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const warning = new Error("emitted");
warning.name = "EmittedWarning";
console.log(process.emit("warning", warning));
const called = new Error("called");
called.name = "CalledWarning";
process.listeners("warning")[0](called);

// functions-native-code-calls/event-listener-that-is-null on an event target that the program gets from a getter: it names no class of event targets.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const { signal } = new Request("http://localhost/");
signal.addEventListener("abort", null);
console.log(signal.aborted);

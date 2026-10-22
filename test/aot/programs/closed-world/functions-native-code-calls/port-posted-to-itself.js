// A message port that is sent its own other end warns and closes.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
const { port1, port2 } = new MessageChannel();
port1.postMessage("lost", [port2]);
console.log("posted");

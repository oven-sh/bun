// The file of a Worker lies two folders above the entry point, and its name is known in part.
// The build found the files, and in the executable the URL says /jobs/first.js, which was the name of nothing: a name was written down only where it was written whole.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const name = process.argv.length > 9 ? process.argv[9] : "first";
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("a URL, in part", new Worker(new URL("../../jobs/" + name + ".js", import.meta.url)));

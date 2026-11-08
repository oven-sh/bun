// A Worker's file lies two folders above the entry point and starts a Worker from a file beside the entry point, which it names by the folders as they are called on disk.
// In an executable the job lies in /$bunfs/_.._/_.._/jobs, and the folders on the way down from there to the entry point are spelled `_.._`: its URL names them as they are called on disk, and the module is /$bunfs/root/inner.js.
// The build writes down what that leads to.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("back into the folder of the entry point", new Worker(new URL("../../jobs/back-down.js", import.meta.url)));

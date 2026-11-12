// The file of a Worker lies three folders above the entry point: the third `..` finds nothing left to take away.
// In an executable the URL says /jobs/job.js: `..` has left nothing of /$bunfs/root. The build writes down what that leads to.
// By itself: a joined path to the same file writes the same name down, and beside one the fault did not show.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", () => end("error"));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("three folders up", new Worker(new URL("../../../jobs/job.js", import.meta.url)));

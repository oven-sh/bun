// A Worker's file lies two folders above the entry point and starts a Worker from a file two folders above itself.
// In an executable the files above the folder of the entry point lie in a mount of their own, /$bunfs/_.._, spelled from the top down: a `..` of the run takes a folder away and leads up, as on disk.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("two folders above the job", new Worker(new URL("../../jobs/two-up.js", import.meta.url)));

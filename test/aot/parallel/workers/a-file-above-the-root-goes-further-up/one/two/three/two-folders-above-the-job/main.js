// A Worker's file lies two folders above the entry point and starts a Worker from a file two folders above itself.
// In an executable the job lies in /$bunfs/root/_.._/_.._/jobs: each `..` that leaves the root is spelled `_.._`. A `..` of the job that should go further up takes one of those back, so the URL says /$bunfs/root/_.._/helper.js,
// which is not where the helper lies. The build writes down what that leads to.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("two folders above the job", new Worker(new URL("../../jobs/two-up.js", import.meta.url)));

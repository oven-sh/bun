// The file three folders up is started by its relative path. The file two folders up is started by the path that a plain executable gives it, written out: a `_.._` behind the root for each folder.
// The module of the first lies at /$bunfs/_.._/_.._/job.js, and its file in the executable was named by what stands behind /$bunfs/: the very name that is written out for the second.
// A start asks the files of the executable first, so the second Worker ran the first file.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("by its relative path", new Worker("../../../job.js"));
const root = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
await report("by its path in a plain executable", new Worker(root + "_.._/_.._/job.js"));
/* Output:
by its relative path: three folders up
by its path in a plain executable: two folders up
*/

// Two files of one name lie two and three folders above the entry point, and the build is given both as entry points, as TS100086 advises: the root of the executable lies above all three, and no `..` leaves it.
// Entry points: ../../job.js ../../../job.js
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("two folders up", new Worker(new URL("../../job.js", import.meta.url).href));
await report("three folders up", new Worker(new URL("../../../job.js", import.meta.url).href));

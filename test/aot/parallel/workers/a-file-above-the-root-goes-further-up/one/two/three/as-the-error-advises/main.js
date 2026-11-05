// As ../past-a-file-of-that-name-beside-the-entry-point, and the build is given the helper.js that is meant as an entry point, as TS100087 advises: the root of the executable lies above all the files, and no path is spelled with `_.._`.
// Entry points: ../../../../helper.js
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("three folders above the job", new Worker(new URL("../../jobs/three-up.js", import.meta.url)));
await report("beside the entry point", new Worker(new URL("./helper.js", import.meta.url)));

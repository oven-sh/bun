// Two files of one name lie two and three folders above the entry point. In an executable `..` leaves /job.js of both paths, and nothing tells the two apart.
// Neither Worker loads, and the build says so. It dropped both names in silence.
// Build prints: 1 x warn: TS100086: In the executable "/job.js" is all that is left of the paths of two files: "../../../job.js" and "../../job.js". A ".." above the root of the executable takes nothing away, so nothing tells the two apart, and a Worker that starts from either fails to load. Pass both files to the build as entry points
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("two folders up", new Worker(new URL("../../job.js", import.meta.url).href));
await report("three folders up", new Worker(new URL("../../../job.js", import.meta.url).href));
/* Output:
two folders up: error
three folders up: error
*/

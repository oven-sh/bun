// A Worker's file lies two folders above the entry point and starts a Worker from helper.js three folders above itself. In an executable its URL says /$bunfs/root/helper.js,
// and the program has a helper.js beside the entry point, whose module has that path. THE WRONG FILE STARTED, IN SILENCE. The build stops and says what helps.
const report = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    [worker.onmessage, worker.onerror] = [event => end(event.data), event => (event.preventDefault(), end("error"))];
  });
await report("three folders above the job", new Worker(new URL("../../jobs/three-up.js", import.meta.url)));
await report("beside the entry point", new Worker(new URL("./helper.js", import.meta.url)));
/* Build errors:
error: TS100087: In the executable "/$bunfs/root/helper.js" is the path of "helper.js", and it is what a file above the folder of the entry point asks for where it means "../../../../helper.js": its own folder is written with "_.._" there, and a ".." takes that away where it should go further up. A Worker that is meant to start from "../../../../helper.js" would start from "helper.js". Pass "../../../../helper.js" to the build as an entry point
*/

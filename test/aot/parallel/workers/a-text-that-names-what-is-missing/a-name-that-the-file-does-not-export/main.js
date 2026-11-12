// A Worker starts from a text that the build knows, and the text imports a name that the file does not export.
// Under `bun run` the Worker fails where it loads the text, whoever started it hears of it, and the program goes on. The build stopped: the load begins at such a text, so it counted as loaded at start.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const hear = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end("message " + event.data);
    worker.onerror = event => (event.preventDefault(), end(String(event.message).split("\n")[0].split(" from ")[0].split(" in module ")[0]));
  });
await hear("a name", new Worker("data:text/javascript,import { nothing } from \"./there.js\"; postMessage(String(nothing))"));
console.log("the program goes on");

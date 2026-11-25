// A Worker starts from a text that the build knows, and a statement of the text imports a package that is not installed.
// Under `bun run` the Worker fails where it loads the text, whoever started it hears of it, and the program goes on. The build stopped: the load begins at such a text, so it counted as loaded at start.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const hear = (how, worker) =>
  new Promise(done => {
    const end = text => (console.log(how + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end("message " + event.data);
    worker.onerror = event => (event.preventDefault(), end(String(event.message).split("\n")[0].split(" from ")[0].split(" in module ")[0]));
  });
await hear("a package", new Worker("data:text/javascript,import \"no-such-package-at-all\"; postMessage(1)"));
console.log("the program goes on");

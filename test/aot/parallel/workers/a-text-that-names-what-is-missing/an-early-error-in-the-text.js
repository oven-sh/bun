// A Worker starts from a text that the build knows, and the text declares a name twice: it parses, and no loader takes it.
// Under `bun run` the Worker fails where it loads the text, whoever started it hears of it, and the program goes on. The build stopped: the load begins at such a text, so it counted as loaded at start.
// The kind of the error alone: the compiled program words it as TypeScript does.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const worker = new Worker("data:text/javascript,let a = 1; let a = 2; postMessage(a)");
await new Promise(done => {
  const end = text => (console.log("a name declared twice: " + text), worker.terminate(), done());
  worker.onmessage = event => end("message " + event.data);
  worker.onerror = event => (event.preventDefault(), end(String(event.message).split(":")[0]));
});
console.log("the program goes on");

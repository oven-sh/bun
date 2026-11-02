// A Worker starts from the `href` of a URL that a variable holds, where a `--define` whose value is that path is the argument. The build compiles the file that the URL names, as where the path is spelled.
// Flags: --define HREF=url.href
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const url = new URL("./w.mjs", import.meta.url);
const worker = new Worker(HREF);
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);

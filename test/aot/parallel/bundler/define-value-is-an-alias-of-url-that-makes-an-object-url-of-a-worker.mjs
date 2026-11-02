// A variable holds the class of URLs, and a `--define` puts the name of the variable in front of `.createObjectURL` where a Worker starts from the text of a Blob. The build compiles the text.
// Flags: --define U=Link
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const Link = URL;
const worker = new Worker(U.createObjectURL(new Blob(['postMessage("the text ran");'], { type: "text/javascript" })));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);

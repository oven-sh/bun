// A store through a name whose `--define` value is a member of an object puts a declared function there that starts a Worker from its parameter, and the member is called with a URL: the build compiles the file.
// Flags: --define SET=tools.make
function make(url) {
  return new Worker(url);
}
const tools = {};
SET = make;
const worker = tools.make(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);

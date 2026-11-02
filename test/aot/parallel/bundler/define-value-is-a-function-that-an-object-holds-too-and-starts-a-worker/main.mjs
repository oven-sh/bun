// A name whose `--define` value is one name is called with a URL. The name is a function that starts a Worker from its parameter and that an object holds too: the build compiles the file.
// Flags: --define MAKE=make
function make(url) {
  return new Worker(url);
}
const tools = { make };
const worker = MAKE(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
console.log(typeof tools.make);

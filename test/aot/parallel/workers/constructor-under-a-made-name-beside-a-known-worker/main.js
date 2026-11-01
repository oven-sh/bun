// One Worker starts from a file that the build knows. Another is made under a name put together at run time, from a text that the build never sees and that asks for modules of the runtime.
// Alone: what an executable holds of the runtime's modules goes by all of its programs
const made = (a, b) => a + b;
const parts = process.env.PARTS ? process.env.PARTS.split(",") : ["Wor", "ker"];
const heard = worker =>
  new Promise(done => {
    const end = text => (console.log(text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("failed: " + event.message));
  });
const text = [
  'const os = require("node:',
  'os"); const path = require("node:',
  'path"); postMessage(typeof os.cpus + " " + path.posix.join("a", "b"));',
].join("");
const urlOf = () => URL.createObjectURL(new Blob([text], { type: "application/javascript" }));
await heard(new Worker("./w.js"));
await heard(new globalThis[made(parts[0], parts[1])](urlOf()));

// One Worker starts from a file that the build knows. Another is made by the constructor that is read from the first, from a text that the build never sees and that asks for modules of the runtime.
// Alone: what an executable holds of the runtime's modules goes by all of its programs
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
const known = new Worker("./w.js");
await heard(known);
await heard(new known.constructor(urlOf()));

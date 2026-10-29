// RUN: lower
// OPTIONS: builtin-modules

// Text that a Worker starts from asks for the module that only Bun's own tests get. It is answered as in plain Bun without the flag of those tests, whatever the environment says.
const worker = new Worker(
  Buffer.from("data:text/").toString() +
    'javascript,import("bun:internal-for-testing").then(loaded => postMessage("loaded " + Object.keys(loaded).length), error => postMessage("refused: " + error.message))',
);
worker.onmessage = (event) => (console.log(event.data), worker.terminate());
worker.onerror = (event) => console.log("error:", event.message);

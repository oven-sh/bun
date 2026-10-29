// What a text finds that a worker starts from.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
const { Worker: NodeWorker } = require("node:worker_threads");
const ask = (what, worker) =>
  new Promise(done => {
    const end = text => (console.log(what + ":", text), worker.terminate(), done());
    if (worker.on) worker.on("message", end).on("error", error => end("error " + error.code));
    else [worker.onmessage, worker.onerror] = [event => end(event.data), () => end("error")];
  });
const then = '.then(m => postMessage(m.beside ?? m.default ?? m.sep), e => postMessage("refused " + e.code))';
const thenOfNode = then.replaceAll("postMessage", 'require("node:worker_threads").parentPort.postMessage');
const object = text => URL.createObjectURL(new Blob([text]));

await ask("data: import() of a built-in module", new Worker('data:text/javascript,import("node:path/posix")' + then));
await ask("data: import of a relative path", new Worker('data:text/javascript,import { beside } from "./beside.js"; postMessage(beside)'));
await ask("data: import of a package", new Worker('data:text/javascript,import pkg from "pkg"; postMessage(pkg)'));
await ask("data: require() of a relative path", new Worker('data:text/javascript,postMessage(require("./beside.js").beside)'));
await ask("data: require() of a package", new Worker('data:text/javascript,postMessage(require("pkg"))'));
await ask("object URL: import() of a relative path", new Worker(URL.createObjectURL(new Blob(['import("./beside.js")' + then]))));
await ask("object URL: import() of a package", new Worker(URL.createObjectURL(new Blob(['import("pkg")' + then]))));
await ask("object URL: import of a relative path", new Worker(URL.createObjectURL(new Blob(['import { beside } from "./beside.js"; postMessage(beside)']))));
await ask("object URL: require() of a relative path", new Worker(URL.createObjectURL(new Blob(['postMessage(require("./beside.js").beside)']))));
await ask("eval: import() of a relative path", new NodeWorker('import("./beside.js")' + thenOfNode, { eval: true }));
await ask("eval: import() of a package", new NodeWorker('import("pkg")' + thenOfNode, { eval: true }));
await ask("eval: require() of a relative path", new NodeWorker('require("node:worker_threads").parentPort.postMessage(require("./beside.js").beside)', { eval: true }));

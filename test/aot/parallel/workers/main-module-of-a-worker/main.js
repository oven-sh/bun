// Alone: which texts the build compiles for a Worker depends on what else the executable holds
const { Worker: NodeWorker } = require("node:worker_threads");
const ask = (what, worker) => new Promise(done => {
  const end = text => (console.log(what, text), worker.terminate(), done());
  if (worker.on) worker.on("message", data => end(JSON.stringify(data))).on("error", error => end("error " + error.message.split("\n")[0]));
  else { worker.onmessage = event => end(JSON.stringify(event.data)); worker.onerror = event => end("error " + event.message.split("\n")[0]); }
});
const short = "(v => String(v).replace(/blob:[-0-9a-f]+/g, 'blob:..').slice(0, 40))";
const head = "const m = require.main; const same = (a, b) => a === b; ";
const list = `([same(m, module), require.main === module, require.main !== module, module === require.main, import.meta.main, !import.meta.main, module.id, ${short}(import.meta.path), ${short}(import.meta.url), ${short}(Bun.main), ${short}(__filename), typeof require.main.require])`;
const esm = `export {}; postMessage([import.meta.main, ${short}(import.meta.path), ${short}(import.meta.url), ${short}(Bun.main)])`;
await ask("cjs blob", new Worker(URL.createObjectURL(new Blob([head + "postMessage" + list]))));
await ask("cjs data", new Worker("data:text/javascript," + encodeURIComponent(head + "postMessage" + list)));
await ask("cjs eval", new NodeWorker(head + "require('node:worker_threads').parentPort.postMessage" + list, { eval: true }));
await ask("cjs file", new Worker(new URL("./w.cjs", import.meta.url)));
await ask("esm blob", new Worker(URL.createObjectURL(new Blob([esm]))));
await ask("esm data", new Worker("data:text/javascript," + encodeURIComponent(esm)));
await ask("esm file", new Worker(new URL("./w.mjs", import.meta.url)));
await ask("inner", new Worker("data:text/javascript," + encodeURIComponent("postMessage(require('./inner.cjs'))")));

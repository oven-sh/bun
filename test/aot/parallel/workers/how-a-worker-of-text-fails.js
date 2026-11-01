// Collections: not forced: the message of an error event quotes a line of the program only while the code that threw is alive
const { Worker: NodeWorker } = require("node:worker_threads");
const first = (text) =>
  String(text)
    .split("\n")[0]
    .replace(/blob:[-0-9a-f]+/g, "blob:..")
    .slice(0, 110);
const web = (what, text) =>
  new Promise((done) => {
    const heard = [];
    const w = new Worker("data:text/javascript," + encodeURIComponent(text));
    w.onmessage = (e) => heard.push(e.data);
    w.onerror = (e) => (
      heard.push("error " + first(e.message)),
      e.preventDefault()
    );
    w.addEventListener(
      "close",
      (e) => (
        console.log(what + ":", heard.join(" | "), "| close", e.code),
        done()
      ),
    );
  });
const node = (what, text, options) =>
  new Promise((done) => {
    const heard = [];
    const w = new NodeWorker(text, { eval: true, ...options });
    w.on("message", (m) => heard.push(JSON.stringify(m)));
    w.on("error", (e) =>
      heard.push("error " + e.name + " " + first(e.message)),
    );
    w.on(
      "exit",
      (code) => (
        console.log(what + ":", heard.join(" | "), "| exit", code),
        done()
      ),
    );
  });
await web("no program", "this is no program");
await web("throws", "postMessage(1); throw new TypeError('thrown at the top')");
await web("rejects", "Promise.reject(new RangeError('nobody catches it'))");
await web("exits", "postMessage('before'); process.exit(3)");
await web("imports what is missing", "import '/nowhere/missing.js'");
await web(
  "imports a package that is missing",
  "import 'no-such-package-at-all'",
);
await web(
  "stack",
  "const f = () => { throw new Error('deep') }; try { f() } catch (e) { postMessage(e.stack.split('\\n').length > 1) }",
);
await node(
  "worker data",
  "const { workerData, parentPort, isMainThread, threadId } = require('node:worker_threads'); parentPort.postMessage([workerData, isMainThread, typeof threadId, typeof Bun, process.argv.length > 0])",
  { workerData: { a: [1, "two", new Map([[1, 2]])] } },
);
await node("node throws", "throw new SyntaxError('from eval: true')");
await node(
  "changes built-ins",
  "Array.prototype.map = () => 'replaced'; Object.prototype.extra = 1; require('node:worker_threads').parentPort.postMessage([[1].map(x => x), ({}).extra])",
);
console.log("main keeps its built-ins:", [1].map((x) => x + 1)[0], {}.extra);

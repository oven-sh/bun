// A worker of text loads the modules of bun.
const { Worker: NodeWorker } = require("node:worker_threads");
const made = (...parts) => parts.join("");
const first = (text) => String(text).split("\n")[0].slice(0, 110);
const web = (what, url) =>
  new Promise((done) => {
    const heard = [];
    const w = new Worker(url);
    w.onmessage = (e) => heard.push(JSON.stringify(e.data));
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
    const w = new NodeWorker(text, options);
    w.on("message", (m) => heard.push(JSON.stringify(m)));
    w.on("error", (e) => heard.push("error " + e.name + " " + first(e.message)));
    w.on(
      "exit",
      (code) => (
        console.log(what + ":", heard.join(" | "), "| exit", code),
        done()
      ),
    );
  });
const data = (...parts) =>
  made("data:text/javascript,", encodeURIComponent(made(...parts)));
const object = (...parts) => URL.createObjectURL(new Blob([made(...parts)]));

await web(
  "require",
  data(
    "postMessage([require('node:os').EOL.length, typeof require('node:zlib').gzipSync, ",
    "require('node:path').posix.join('a', 'b'), require('node:util').format('%s-%d', 'x', 2)])",
  ),
);
await web(
  "static import",
  data(
    "import { EventEmitter } from 'node:events'; import { Buffer } from 'node:buffer'; ",
    "postMessage([typeof EventEmitter, Buffer.from('ab').toString('hex')])",
  ),
);
await web(
  "import()",
  data(
    "import('node:querystring').then(m => postMessage(m.stringify({ a: ",
    "1, b: 'two' })))",
  ),
);
await web(
  "object URL",
  object(
    "postMessage([require('node:crypto').createHash('sha1').update('a').digest('hex'), ",
    "require('node:url').pathToFileURL('/a b').href])",
  ),
);
await web(
  "what the host makes of its modules",
  data(
    "const stream = new ReadableStream({ start(c) { c.enqueue('chunk'); c.close(); } }); ",
    "const chunks = []; for await (const chunk of stream) chunks.push(chunk); ",
    "postMessage([chunks, Bun.inspect({ a: [1] }), typeof process.nextTick, typeof process.stdout.write, structuredClone(new Map([[1, 2]])).size])",
  ),
);
await web(
  "timers and streams",
  data(
    "const { Readable } = require('node:stream'); const { setTimeout: wait } = require('node:timers/promises'); ",
    "await wait(1); const parts = []; for await (const part of Readable.from(['a', 'b'])) parts.push(part); postMessage(parts)",
  ),
);
await node(
  "eval",
  made(
    "const { parentPort, workerData } = require('node:worker_threads'); ",
    "parentPort.postMessage([workerData, require('node:assert').strictEqual.name, require('node:fs').existsSync('/')])",
  ),
  { eval: true, workerData: { n: 1 } },
);
await node(
  "a URL with text",
  new URL(
    data(
      "import { parentPort } from 'node:worker_threads'; import { inspect } from 'node:util'; ",
      "parentPort.postMessage(inspect(new Set([1])))",
    ),
  ),
);
await web(
  "a worker of text starts a worker of text",
  data(
    "const inner = new Worker('data:text/javascript,' + encodeURIComponent(['postMessage(require(\"node:', 'os\").EOL.length)'].join(''))); ",
    "inner.onmessage = e => { postMessage(['inner', e.data]); inner.terminate(); }",
  ),
);
await node(
  "a worker of text starts a worker of node",
  made(
    "const { Worker, parentPort } = require('node:worker_threads'); ",
    "new Worker(['require(\"node:worker_threads\").parentPort.postMessage(', 'require(\"node:path\").sep)'].join(''), { eval: true }).on('message', m => parentPort.postMessage(['inner', m]))",
  ),
  { eval: true },
);

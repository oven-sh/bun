import http from "node:http";
import { Readable, addAbortSignal, finished, isWritable, pipeline } from "node:stream";

const lines = [];
function probe(title, stream) {
  let isStream = "a stream";
  try {
    addAbortSignal(new AbortController().signal, stream);
  } catch (error) {
    isStream = error.code;
  }
  lines.push(title + ": " + isStream + " . writable " + isWritable(stream));
}
async function* pages() {
  yield "one";
  yield "two";
}
function serve(handle) {
  return new Promise(resolve => {
    const server = http.createServer(handle);
    server.listen(0, "127.0.0.1", async () => {
      let body;
      try {
        body = await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
      } catch (error) {
        body = "failed: " + error.name;
      }
      server.close(() => resolve(body));
    });
  });
}
const turns = Number(process.argv[2] ?? 2);
for (let turn = 0; turn < turns; turn++) {
  const body = await serve((req, res) => {
    const write = res.write;
    const on = res.on;
    let writes = 0;
    let listens = 0;
    res.write = function (...args) { writes++; return write.apply(this, args); };
    res.on = function (...args) { listens++; return on.apply(this, args); };
    probe("write and on replaced", res);
    pipeline(Readable.from(pages()), res, error => lines.push("pipeline: " + (error ? error.code : "done") + " . writes " + writes + " . listens " + listens));
  });
  lines.push("body " + body);
}
console.log(lines.join("\n"));

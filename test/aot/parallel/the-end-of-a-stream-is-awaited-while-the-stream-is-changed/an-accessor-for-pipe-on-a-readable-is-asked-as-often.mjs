import { Readable, addAbortSignal, finished, isReadable, pipeline, Writable } from "node:stream";

const lines = [];
const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
function probe(title, stream) {
  let isStream = "a stream";
  try {
    addAbortSignal(new AbortController().signal, stream);
  } catch (error) {
    isStream = error.code;
  }
  lines.push(title + ": " + isStream + " . readable " + isReadable(stream));
}
async function watch(title, stream, then) {
  let said = "nothing yet";
  try {
    finished(stream, error => {
      said = error ? (error.code ?? error.name) : "ended";
    });
  } catch (error) {
    said = "threw " + error.code;
  }
  then?.();
  await settle();
  lines.push(title + ": " + said);
}
const turns = Number(process.argv[2] ?? 60);
for (let turn = 0; turn < turns; turn++) {
  let asks = 0;
  const spool = new Readable({ read() {} });
  const pipe = spool.pipe;
  Object.defineProperty(spool, "pipe", { configurable: true, get() { asks++; return pipe; } });
  probe("an accessor lies under pipe", spool);
  await watch("the end of it", spool, () => spool.push(null));
  lines.push("asked " + asks);
}
console.log(lines.join("\n"));

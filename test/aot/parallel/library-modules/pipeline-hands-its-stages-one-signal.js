// stream.pipeline() hands every stage that is a function one AbortSignal, which is aborted when the pipeline ends, well or badly. A pipeline of streams alone hands it to nobody.
const { pipeline, Readable, Writable, PassThrough } = require("node:stream");
const log = [];
function collector(into) {
  return new Writable({
    write(chunk, encoding, done) {
      into.push(String(chunk));
      done();
    },
  });
}
function run(label, stages) {
  return new Promise(resolve => {
    pipeline(...stages, error => {
      log.push(label + " ended " + (error ? error.name + " " + error.message : "well"));
      resolve();
    });
  });
}
async function main() {
  const plain = [];
  await run("streams alone", [Readable.from(["a", "b", "c"]), new PassThrough(), collector(plain)]);
  log.push("streams alone " + plain.join(""));

  const signals = [];
  const staged = [];
  await run("two stages", [
    async function* ({ signal }) {
      signals.push(signal);
      log.push("source sees aborted " + signal.aborted);
      yield "x";
      yield "y";
    },
    async function* (source, { signal }) {
      signals.push(signal);
      for await (const chunk of source) yield String(chunk).toUpperCase();
    },
    collector(staged),
  ]);
  log.push("two stages " + staged.join("") + " one signal " + (signals[0] === signals[1]) + " is a signal " + (signals[0] instanceof AbortSignal));
  log.push("afterwards aborted " + signals[0].aborted + " " + signals[0].reason.name);

  let heard = 0;
  let kept;
  await run("a stage throws", [
    Readable.from(["1", "2"]),
    async function* (source, { signal }) {
      kept = signal;
      signal.addEventListener("abort", () => heard++);
      for await (const chunk of source) {
        if (chunk === "2") throw new RangeError("two");
        yield chunk;
      }
    },
    collector([]),
  ]);
  log.push("a stage throws: aborted " + kept.aborted + " heard " + heard);

  const outer = new AbortController();
  run("one that never ends", [
    new Readable({ read() {} }),
    async function* (source, { signal }) {
      kept = signal;
      for await (const chunk of source) yield chunk;
    },
    collector([]),
  ]);
  await new Promise(resolve => setImmediate(resolve));
  log.push("still running: aborted " + kept.aborted);
  const promised = require("node:stream/promises")
    .pipeline(new Readable({ read() {} }), collector([]), { signal: outer.signal })
    .catch(error => log.push("promised pipeline " + error.name));
  outer.abort();
  await promised;
  console.log(log.join("\n"));
  process.exit(0);
}
main();

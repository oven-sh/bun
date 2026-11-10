import { pipeline, Readable, Writable } from "node:stream";
const lines = [];
const seen = { abort: 0, signal: 0, aborted: 0 };
const abort = AbortController.prototype.abort;
const signal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal");
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
const source = () => Readable.from(["a", "b"]);
const sink = () =>
  new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      callback();
    },
  });
const run = (...stages) =>
  new Promise(resolve => {
    pipeline(...stages, error => setImmediate(resolve, error ? error.name : "none"));
    lines.push("behind the call: abort " + seen.abort + " signal " + seen.signal + " aborted " + seen.aborted);
  });
async function ask(label, ...stages) {
  seen.abort = seen.signal = seen.aborted = 0;
  const ended = await run(...stages);
  lines.push(label + ": " + ended + " abort " + seen.abort + " signal " + seen.signal + " aborted " + seen.aborted);
}
await ask("as built", source(), sink());
AbortController.prototype.abort = function (...given) {
  seen.abort++;
  return abort.apply(this, given);
};
await ask("abort replaced", source(), sink());
Object.defineProperty(AbortController.prototype, "signal", {
  ...signal,
  get() {
    seen.signal++;
    return signal.get.call(this);
  },
});
await ask("signal replaced", source(), sink());
await ask(
  "two stages that are functions",
  async function* () {
    yield "a";
  },
  async function* (from) {
    for await (const chunk of from) yield chunk;
  },
  sink(),
);
Object.defineProperty(AbortSignal.prototype, "aborted", {
  ...aborted,
  get() {
    seen.aborted++;
    return aborted.get.call(this);
  },
});
await ask("aborted replaced", source(), sink());
Object.defineProperty(AbortSignal.prototype, "aborted", {
  ...aborted,
  get() {
    seen.aborted++;
    return true;
  },
});
await ask("a signal that says it is aborted", source(), sink());
Object.defineProperty(AbortSignal.prototype, "aborted", aborted);
Object.defineProperty(AbortController.prototype, "signal", signal);
AbortController.prototype.abort = abort;
{
  const Usual = AbortController;
  let made = 0;
  globalThis.AbortController = class extends Usual {
    constructor() {
      super();
      made++;
    }
  };
  await ask("the class replaced", source(), sink());
  lines.push("made " + made);
  globalThis.AbortController = Usual;
}
{
  const first = source();
  const on = first.on;
  first.on = function (...given) {
    AbortController.prototype.abort = function (...all) {
      seen.abort++;
      return abort.apply(this, all);
    };
    return on.apply(this, given);
  };
  await ask("abort replaced while the pipeline is laid", first, sink());
  AbortController.prototype.abort = abort;
}
console.log(lines.join("\n"));
process.exit(0);

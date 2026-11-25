// The generator behind Readable.from() is stepped by the program as well, is left early, runs under async contexts, and feeds a pipe, a loop and a pipeline.
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable, Writable, pipeline } from "node:stream";
import { finished } from "node:stream/promises";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));

async function* numbers(name, to, wait) {
  try {
    for (let i = 1; i <= to; i++) {
      if (wait) await tick();
      const sent = yield name + i;
      if (sent !== undefined) say("  sent", sent);
    }
    return "returned";
  } finally {
    say("  " + name + " is left");
  }
}

say("== the program steps it too");
for (const wait of [false, true]) {
  const generator = numbers("n", 6, wait);
  const first = generator.next();
  const stream = Readable.from(generator);
  const second = generator.next("by the program");
  const seen = [];
  stream.on("data", chunk => {
    seen.push(chunk);
    if (seen.length === 2) generator.next("amid the stream").then(result => say("  amid", JSON.stringify(result)));
  });
  await finished(stream);
  say("  first", JSON.stringify(await first), "second", JSON.stringify(await second), "seen", seen.join());
}

say("== a loop that leaves early");
for (const wait of [false, true]) {
  const stream = Readable.from(numbers("e", 5, wait));
  for await (const chunk of stream) {
    say("  got", chunk);
    if (chunk === "e2") break;
  }
  await tick();
  say("  destroyed", stream.destroyed);
}

say("== destroyed with an error");
for (const wait of [false, true]) {
  const stream = Readable.from(numbers("d", 5, wait));
  stream.once("data", chunk => (say("  got", chunk), stream.destroy(new Error("enough"))));
  await finished(stream).catch(error => say("  failed", error.message));
}

say("== destroyed before the first step");
{
  const stream = Readable.from(numbers("b", 2, false));
  stream.destroy();
  await finished(stream).catch(error => say("  failed", error.code));
}

say("== contexts");
{
  const storage = new AsyncLocalStorage();
  async function* asks() {
    yield "at the start " + storage.getStore();
    await tick();
    yield "behind an await " + storage.getStore();
    storage.enterWith("entered inside");
    yield "entered " + storage.getStore();
    await tick();
    yield "and behind another " + storage.getStore();
  }
  const generator = storage.run("of the maker", asks);
  await storage.run("of the reader", async () => {
    const stream = Readable.from(generator);
    stream.on("data", chunk => say("  " + chunk + " | the listener: " + storage.getStore()));
    await finished(stream);
    say("  behind the stream: " + storage.getStore());
  });
}

say("== a pipe into a slow writer");
{
  const written = [];
  const writer = new Writable({
    objectMode: true,
    highWaterMark: 1,
    write(chunk, encoding, done) {
      written.push(chunk);
      setImmediate(done);
    },
  });
  Readable.from(numbers("p", 5, false)).pipe(writer);
  await finished(writer);
  say("  written", written.join());
}

say("== a pipeline that fails in the writer");
await new Promise(resolve => {
  const writer = new Writable({
    objectMode: true,
    write(chunk, encoding, done) {
      done(chunk === "f3" ? new Error("no more") : null);
    },
  });
  pipeline(Readable.from(numbers("f", 9, true)), writer, error => (say("  ended with", error?.message), resolve()));
});
await tick();

say("== many at once");
{
  const streams = [1, 2, 3].map(n => Readable.from(numbers("m" + n + ".", n + 1, n % 2 === 0)));
  const all = await Promise.all(streams.map(stream => stream.toArray()));
  say("  " + all.map(list => list.join()).join(" | "));
}

say("== paused and resumed");
{
  const stream = Readable.from(numbers("r", 4, false));
  const seen = [];
  stream.on("data", chunk => {
    seen.push(chunk);
    stream.pause();
    setImmediate(() => stream.resume());
  });
  await finished(stream);
  say("  seen", seen.join());
}

say("== read by hand");
{
  const stream = Readable.from(numbers("h", 3, true));
  const seen = [];
  stream.on("readable", () => {
    for (let chunk; (chunk = stream.read()) !== null; ) seen.push(chunk);
  });
  await finished(stream);
  say("  seen", seen.join());
}

console.log(log.join("\n"));

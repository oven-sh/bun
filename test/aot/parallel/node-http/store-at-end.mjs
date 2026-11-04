// `finish`, `close` and the callback of end() run in the async context that end() was called in, whatever write() was called in.
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";

const store = new AsyncLocalStorage();
const whens = {
  "same turn": run => run(),
  "a job": run => queueMicrotask(run),
  "a tick": run => process.nextTick(run),
  "a timer": run => setTimeout(run, 1),
};
const length = (res, bytes) => res.setHeader("Content-Length", bytes);
// What runs under the store "write", and what runs later. `under` runs its argument under the store "end".
const forms = {
  "write, end": [res => (length(res, 1), res.write("a")), (res, done, under) => under(() => res.end(done))],
  "write, end without a callback": [
    res => (length(res, 1), res.write("a")),
    (res, done, under) => under(() => res.end()),
  ],
  "write, end with data": [
    res => (length(res, 2), res.write("a")),
    (res, done, under) => under(() => res.end("b", done)),
  ],
  "write, then write and end": [
    res => (length(res, 2), res.write("a")),
    (res, done, under) => under(() => (res.write("b"), res.end(done))),
  ],
  "two writes, end": [
    res => (length(res, 2), res.write("a"), res.write("b")),
    (res, done, under) => under(() => res.end(done)),
  ],
  "write, flushHeaders and end": [
    res => (length(res, 1), res.write("a")),
    (res, done, under) => under(() => (res.flushHeaders(), res.end(done))),
  ],
  "writeHead and write, end": [
    res => (res.writeHead(200, { "Content-Length": 1 }), res.write("a")),
    (res, done, under) => under(() => res.end(done)),
  ],
  "a buffer, end": [
    res => (length(res, 1), res.write(Buffer.from("a"))),
    (res, done, under) => under(() => res.end(done)),
  ],
  "no length, end": [res => res.write("a"), (res, done, under) => under(() => res.end(done))],
  "write, end under no store": [res => (length(res, 1), res.write("a")), (res, done) => res.end(done)],
  "write, end behind exit()": [
    res => (length(res, 1), res.write("a")),
    (res, done, under) => under(() => store.exit(() => res.end(done))),
  ],
  "write, end under another storage": [
    res => (length(res, 1), res.write("a")),
    (res, done, under) => under(() => new AsyncLocalStorage().run("other", () => res.end(done))),
  ],
  "write, end under the same store": [
    res => (length(res, 1), res.write("a")),
    (res, done) => store.run("write", () => res.end(done)),
  ],
};

let seen, closed;
const server = http.createServer((req, res) => {
  const [form, when] = JSON.parse(decodeURIComponent(req.url.slice(1)));
  const say = what => seen.push(what + " " + store.getStore());
  for (const event of ["prefinish", "finish"]) res.on(event, () => say(event));
  res.on("close", () => (say("close"), closed()));
  store.run("write", () => forms[form][0](res));
  whens[when](() =>
    forms[form][1](
      res,
      () => say("callback"),
      run => store.run("end", run),
    ),
  );
});
server.listen(0, "127.0.0.1", async () => {
  for (const form of Object.keys(forms)) {
    for (const when of Object.keys(whens)) {
      seen = [];
      const isClosed = new Promise(resolve => (closed = resolve));
      const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(JSON.stringify([form, when]))}`;
      const body = await fetch(url).then(
        answer => answer.text(),
        () => "no answer",
      );
      await isClosed;
      console.log(`${form}, ${when}: ${JSON.stringify(body)}: ${seen.join(", ")}`);
    }
  }
  server.close();
});

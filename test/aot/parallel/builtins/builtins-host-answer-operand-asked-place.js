// Built-ins of the host that answer an operand (`return this` of EventEmitter, process, timers, Buffer, HTMLRewriter and what it hands its handlers, servers, hashers; crypto.getRandomValues, Bun.peek), asked in place whether they do.
const EventEmitter = require("node:events");
const { StringDecoder } = require("node:string_decoder");
function show(label, ...values) { console.log(label, ...values); }
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}
function listener() {}
attempt("EventEmitter", () => {
  const emitter = new EventEmitter();
  show("EventEmitter", emitter.on("a", listener) === emitter, emitter.once("a", listener) === emitter, emitter.addListener("a", listener) === emitter, emitter.prependListener("a", listener) === emitter,
    emitter.prependOnceListener("a", listener) === emitter, emitter.off("a", listener) === emitter, emitter.removeListener("a", listener) === emitter, emitter.removeAllListeners("a") === emitter, emitter.removeAllListeners() === emitter,
    emitter.setMaxListeners(20) === emitter);
});
attempt("a class below EventEmitter", () => {
  class Mine extends EventEmitter { tag = 1; }
  const mine = new Mine();
  const got = mine.on("a", listener);
  got.extra = 2;
  show("a class below EventEmitter", got === mine, mine.extra, got.tag);
});
attempt("EventEmitter's methods on another object", () => {
  const bare = { tag: 1 };
  const got = EventEmitter.prototype.on.call(bare, "a", listener);
  got.extra = 2;
  show("EventEmitter's methods on another object", got === bare, bare.extra, typeof bare._events);
});
attempt("process", () => {
  show("process", process.on("custom", listener) === process, process.once("custom", listener) === process, process.off("custom", listener) === process, process.removeAllListeners("custom") === process,
    process.addListener("custom", listener) === process, process.removeListener("custom", listener) === process, process.prependListener("custom", listener) === process);
  process.removeAllListeners("custom");
});
attempt("timers", () => {
  const timeout = setTimeout(listener, 1);
  show("Timeout", timeout.ref() === timeout, timeout.unref() === timeout, timeout.refresh() === timeout, timeout.close() === timeout, timeout.hasRef());
  const interval = setInterval(listener, 1000);
  show("Interval", interval.unref() === interval, interval.ref() === interval, interval.close() === interval);
  const immediate = setImmediate(listener);
  show("Immediate", immediate.ref() === immediate, immediate.unref() === immediate);
  clearImmediate(immediate);
  const ref = timeout.ref;
  show("ref on another object", ref.call({ other: true }), ref.call(5));
});
attempt("Buffer", () => {
  const buffer = Buffer.alloc(8);
  show("Buffer", buffer.fill(1) === buffer, buffer.swap16() === buffer, buffer.swap32() === buffer, buffer.swap64() === buffer, buffer.fill("ab", 0, 4, "latin1") === buffer);
  const bytes = new Uint8Array(8);
  show("Buffer's methods on bytes", Buffer.prototype.fill.call(bytes, 1) === bytes, Buffer.prototype.swap16.call(bytes) === bytes);
});
attempt("crypto", () => {
  const bytes = new Uint8Array(4);
  const words = new Uint32Array(2);
  show("crypto", crypto.getRandomValues(bytes) === bytes, crypto.getRandomValues(words) === words);
});
attempt("crypto refuses", () => crypto.getRandomValues({}));
attempt("HTMLRewriter", () => {
  const rewriter = new HTMLRewriter();
  const seen = [];
  const handlers = {
    element(element) {
      seen.push(element.setAttribute("a", "1") === element, element.removeAttribute("a") === element, element.before("x") === element, element.after("y") === element, element.prepend("p") === element,
        element.append("q") === element, element.setInnerContent("in") === element);
      const attributes = element.attributes;
      seen.push(attributes[Symbol.iterator]() === attributes);
    },
    text(chunk) { seen.push(chunk.before("b") === chunk, chunk.after("a") === chunk); },
    comments(comment) { seen.push(comment.before("b") === comment, comment.after("a") === comment, comment.replace("r") === comment); },
  };
  show("HTMLRewriter", rewriter.on("p", handlers) === rewriter, rewriter.onDocument({ end(end) { seen.push(end.append("z") === end); } }) === rewriter);
  show("rewritten", rewriter.transform("<p k='v'>t<!--c--></p>"), seen.join());
});
attempt("Bun.peek", () => {
  const pending = new Promise(() => {});
  const settled = Promise.resolve(7);
  const held = { held: true };
  show("Bun.peek", Bun.peek(pending) === pending, Bun.peek(settled), Bun.peek(held) === held, Bun.peek(5), Bun.peek(Promise.resolve(held)) === held);
});
attempt("process.report.writeReport", () => {
  const held = { held: true };
  const got = process.report.writeReport(held);
  show("process.report.writeReport", got === held, typeof got);
});
attempt("StringDecoder called", () => {
  const made = new StringDecoder("utf8");
  show("StringDecoder", made instanceof StringDecoder, made.encoding);
  const bare = Object.create(StringDecoder.prototype);
  const got = StringDecoder.call(bare, "utf8");
  show("StringDecoder called", got === bare, got === undefined, bare.encoding);
});
attempt("servers", () => {
  const server = Bun.serve({ port: 0, fetch() { return new Response("x"); } });
  show("servers", server.ref() === server, server.unref() === server, server.reload({ fetch() { return new Response("y"); } }) === server);
  server.stop(true);
});
attempt("Bun.CryptoHasher", () => {
  const hasher = new Bun.CryptoHasher("sha1");
  show("Bun.CryptoHasher", hasher.update("a") === hasher, new Bun.SHA1().update("a") instanceof Bun.SHA1);
  const sha = new Bun.SHA1();
  show("Bun.SHA1", sha.update("a") === sha);
  const into = new Uint8Array(20);
  show("digest into", new Bun.SHA1().update("a").digest(into) === into, Bun.SHA1.hash("a", into) === into, new Bun.CryptoHasher("sha1").update("a").digest(into) === into);
});
attempt("URLSearchParams and Headers", () => {
  const headers = new Headers();
  show("Headers", headers.set("a", "1"), headers.append("a", "2"), headers.delete("a"));
  const params = new URLSearchParams();
  show("URLSearchParams", params.set("a", "1"), params.append("a", "2"), params.sort());
});
setTimeout(() => process.exit(0), 30);

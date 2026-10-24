// What functions that are handed to streams, timers, events and observers see as `this` and as their arguments.
const lines = [];
function seen(name, self, given, known = {}) {
  const word = v => { for (const [k, o] of Object.entries(known)) if (o === v) return k; return v === undefined ? "undefined" : v === null ? "null" : v === globalThis ? "globalThis" : typeof v === "object" ? v.constructor?.name ?? "object" : typeof v; };
  lines.push(name + ": this " + word(self) + ", " + given.length + ": " + Array.from(given, word).join());
}
const source = {
  start(controller) { seen("source.start", this, arguments, { source }); },
  pull(controller) { seen("source.pull", this, arguments, { source }); controller.enqueue("a"); controller.close(); },
  cancel(reason) { seen("source.cancel", this, arguments, { source }); },
};
const strategy = { highWaterMark: 1, size(chunk) { seen("strategy.size", this, arguments, { strategy }); return 1; } };
for await (const chunk of new ReadableStream(source, strategy)) lines.push("chunk " + chunk);
const cancelled = new ReadableStream(source); await cancelled.cancel("why");
const sink = {
  start(controller) { seen("sink.start", this, arguments, { sink }); },
  write(chunk, controller) { seen("sink.write", this, arguments, { sink }); },
  close() { seen("sink.close", this, arguments, { sink }); },
  abort(reason) { seen("sink.abort", this, arguments, { sink }); },
};
const writer = new WritableStream(sink).getWriter(); await writer.write("w"); await writer.close();
await new WritableStream(sink).abort("why");
const transformer = {
  start(controller) { seen("transformer.start", this, arguments, { transformer }); },
  transform(chunk, controller) { seen("transformer.transform", this, arguments, { transformer }); controller.enqueue(chunk); },
  flush(controller) { seen("transformer.flush", this, arguments, { transformer }); },
};
const through = new TransformStream(transformer); const tw = through.writable.getWriter(); tw.write("t"); tw.close();
for await (const chunk of through.readable) lines.push("through " + chunk);
await new Promise(resolve => setTimeout(function () { seen("setTimeout", this, arguments); resolve(); }, 1, "x", 2));
await new Promise(resolve => setImmediate(function () { seen("setImmediate", this, arguments); resolve(); }, "x"));
await new Promise(resolve => { const id = setInterval(function () { seen("setInterval", this, arguments); clearInterval(id); resolve(); }, 1, "x"); });
await new Promise(resolve => queueMicrotask(function () { seen("queueMicrotask", this, arguments); resolve(); }));
await new Promise(resolve => process.nextTick(function () { seen("nextTick", this, arguments); resolve(); }, 1, 2));
const target = new EventTarget();
target.addEventListener("ping", function (event) { seen("listener", this, arguments, { target }); });
const listener = { handleEvent(event) { seen("handleEvent", this, arguments, { target, listener }); } };
target.addEventListener("ping", listener);
target.dispatchEvent(new Event("ping"));
const controller = new AbortController();
controller.signal.onabort = function (event) { seen("onabort", this, arguments, { signal: controller.signal }); };
controller.signal.addEventListener("abort", function (event) { seen("abort listener", this, arguments, { signal: controller.signal }); });
controller.abort();
const channel = new MessageChannel();
await new Promise(resolve => { channel.port1.onmessage = function (event) { seen("onmessage", this, arguments, { port1: channel.port1 }); resolve(); }; channel.port2.postMessage("m"); });
channel.port1.close(); channel.port2.close();
new HTMLRewriter().on("p", { element(e) { seen("element", this, arguments); }, text(t) { seen("text", this, arguments); }, comments(c) { seen("comments", this, arguments); } }).onDocument({ end(e) { seen("end", this, arguments); }, doctype(d) { seen("doctype", this, arguments); } }).transform("<!doctype html><p>a<!--c--></p>");
process.once("custom", function () { seen("process.once", this, arguments, { process }); }); process.emit("custom", 1, 2);
const registry = new FinalizationRegistry(function () {});
structuredClone({ get x() { seen("getter under structuredClone", this, arguments); return 1; } });
JSON.stringify({ toJSON(key) { seen("toJSON", this, arguments); return 1; } });
[3, 1].sort(function (a, b) { seen("sort", this, arguments); return a - b; });
"ab".replace(/a/, function () { seen("replace", this, arguments); return "x"; });
Array.from({ length: 1 }, function () { seen("Array.from", this, arguments); });
new Promise(function () { seen("executor", this, arguments); });
await Promise.resolve(1).then(function () { seen("then", this, arguments); });
await Promise.resolve(1).finally(function () { seen("finally", this, arguments); });
await { then(resolve) { seen("thenable", typeof this, arguments); resolve(); } };
Bun.inspect({ [Bun.inspect.custom](depth, options, inspect) { seen("inspect.custom", typeof this, arguments); return "x"; } });
console.log(lines.join("\n"));

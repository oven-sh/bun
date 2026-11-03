// The functions of node:stream that ask whether a value is a web stream: of Node's streams, web streams, classes below either, look-alikes and what is no stream at all.
const stream = require("node:stream");
class BelowWeb extends ReadableStream { constructor() { super({ start(controller) { controller.enqueue("x"); controller.close(); } }); this.mine = 1; } }
class BelowWebWritable extends WritableStream {}
class BelowNode extends stream.Readable { _read() { this.push(null); } }
function Old() { stream.Writable.call(this); } Object.setPrototypeOf(Old.prototype, stream.Writable.prototype); Old.prototype._write = function (chunk, encoding, done) { done(); };
const make = [
  () => new stream.Readable({ read() { this.push(null); } }), () => new stream.Writable({ write(c, e, d) { d(); } }), () => new stream.Duplex({ read() { this.push(null); }, write(c, e, d) { d(); } }), () => new stream.PassThrough(),
  () => new BelowNode(), () => new Old(), () => new ReadableStream({ start(c) { c.close(); } }), () => new WritableStream(), () => new TransformStream(), () => new BelowWeb(), () => new BelowWebWritable(),
  () => ({ pipe() {}, on() {}, read() {} }), () => ({ getReader() {}, locked: false }), () => Object.create(ReadableStream.prototype), () => new Proxy(new ReadableStream(), {}), () => ({}), () => [], () => () => {}, () => null, () => undefined, () => 5, () => "text", () => Symbol.iterator, () => new Response("x").body,
];
const questions = ["isReadable", "isWritable", "isErrored", "isDisturbed", "isDestroyed"].filter(name => typeof stream[name] === "function");
const ask = (name, value) => { try { return String(stream[name](value)); } catch (error) { return error.code ?? error.name; } };
let lines = [];
for (let round = 0; round < 30; round++) lines = questions.map(name => name + ": " + make.map(create => ask(name, create())).join());
console.log(lines.join("\n"));
const ended = [];
let waiting = 0;
make.forEach((create, index) => {
  const value = create();
  try { waiting++; stream.finished(value, error => { ended.push(index + (error ? " " + (error.code ?? error.name) : " done")); if (--waiting === 0) report(); }); if (value?.resume) value.resume(); if (value?.end) value.end(); if (value?.cancel && !value.locked) value.cancel().catch(() => {}); if (value?.close && !value.locked) value.close().catch(() => {}); } catch (error) { waiting--; ended.push(index + " refused " + (error.code ?? error.name)); }
});
const report = () => console.log(ended.sort((a, b) => parseInt(a) - parseInt(b)).join("; "));
setTimeout(() => { if (waiting > 0) { ended.push("still waiting: " + waiting); report(); } process.exit(0); }, 300);
try { console.log(stream.compose(new ReadableStream({ start(c) { c.enqueue("a"); c.close(); } }), new stream.PassThrough()) instanceof stream.Duplex, stream.Duplex.from(new BelowWeb()) instanceof stream.Duplex, stream.Readable.fromWeb(new BelowWeb()) instanceof stream.Readable); } catch (error) { console.log(error.code ?? error.name); }

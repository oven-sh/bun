import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const lines = [];
const make = (options = {}) => new Readable({ read() {}, ...options });
const later = () => new Promise(resolve => setTimeout(resolve, 10));
{
  let asks = 0;
  const usual = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Readable, Symbol.hasInstance, {
    configurable: true,
    value(value) {
      asks++;
      return usual.call(this, value);
    },
  });
  make();
  lines.push("new " + asks);
  asks = 0;
  class Below extends Readable {}
  new Below({ read() {} });
  lines.push("below " + asks);
  asks = 0;
  Readable({ read() {} });
  lines.push("called " + asks);
  delete Readable[Symbol.hasInstance];
}
for (const way of ["push", "unshift"]) {
  const own = make({ defaultEncoding: "latin1" });
  Object.defineProperty(own._readableState, "defaultEncoding", { value: "hex", configurable: true });
  own[way]("4142");
  lines.push(way + " default encoding " + own.read().toString("hex"));
  const same = make();
  Object.defineProperty(same._readableState, "encoding", { value: "utf8", configurable: true });
  same[way]("text", "utf8");
  lines.push(way + " encoding " + typeof same.read());
}
{
  const foreign = { buffer: [Buffer.from("ab")], bufferIndex: 0, length: 2 };
  const stream = make();
  stream._readableState = foreign;
  stream.setEncoding("latin1");
  lines.push(
    "foreign " + [typeof foreign.decoder, foreign.encoding, foreign.length, JSON.stringify(foreign.buffer)].join(" "),
  );
  const own = make();
  let stored = "";
  Object.defineProperty(own._readableState, "encoding", {
    configurable: true,
    get: () => null,
    set(value) {
      stored += value;
    },
  });
  own.setEncoding("utf8");
  lines.push("own accessor " + (stored || "nothing"));
  const plain = make();
  plain.push("ab");
  plain.setEncoding("hex");
  lines.push("plain " + [plain.readableEncoding, typeof plain._readableState.decoder, plain.read()].join(" "));
}
for (const objectMode of [false, true]) {
  let asks = 0;
  const heard = [];
  const stream = make({ objectMode });
  stream.push("a");
  stream.push("b");
  Object.defineProperty(stream, "emit", {
    configurable: true,
    get() {
      asks++;
      return function (name, value) {
        heard.push(name + ":" + value);
        return EventEmitter.prototype.emit.apply(this, arguments);
      };
    },
  });
  lines.push("read " + stream.read() + " asks of emit " + asks + " " + heard.join());
}
function counted(answers) {
  const chunk = Buffer.from("abcde");
  let asks = 0;
  Object.defineProperty(chunk, "length", {
    configurable: true,
    get() {
      return answers[Math.min(asks++, answers.length - 1)];
    },
  });
  return [chunk, () => asks];
}
for (const way of ["push", "unshift"]) {
  const stream = make();
  const [chunk, asks] = counted([3, 5]);
  stream[way](chunk);
  lines.push(way + " buffered " + stream.readableLength + " asks " + asks());
  const flowing = make();
  flowing.on("data", () => {});
  await later();
  const [other, asksOfOther] = counted([5]);
  flowing[way](other);
  lines.push(way + " flowing asks " + asksOfOther());
}
for (const size of [2, 5]) {
  const stream = make();
  const [chunk, asks] = counted([5]);
  stream.push(chunk);
  stream.push(Buffer.from("fgh"));
  const before = asks();
  lines.push("read(" + size + ") " + stream.read(size).length + " asks " + (asks() - before));
}
for (const lay of [{ value: false }, { get: () => false, configurable: true }]) {
  const told = [];
  const stream = new Readable({
    read() {
      this.push(null);
    },
  });
  Object.defineProperty(stream._readableState, "autoDestroy", lay);
  for (const name of ["end", "close"]) stream.on(name, () => told.push(name));
  stream.resume();
  await later();
  lines.push("keeps itself " + told.join() + " " + stream.destroyed);
  const iterated = new Readable({
    read() {
      this.push(null);
    },
  });
  Object.defineProperty(iterated._readableState, "autoDestroy", lay);
  for await (const chunk of iterated) lines.push("chunk " + chunk);
  await later();
  lines.push("iterated " + iterated.destroyed);
}
console.log(lines.join("\n"));
process.exit(0);

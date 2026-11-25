// read() is the method of every stream with a readable side. Each kind is read by hand here, in paused mode, and looked at in front of and behind every call.
const { Readable, Duplex, Transform, PassThrough } = require("node:stream");
const { createReadStream } = require("node:fs");
const { createServer, request } = require("node:http");
const { createGzip, createGunzip } = require("node:zlib");
const vm = require("node:vm");
const lines = [];
const facesOfState = ["reading", "sync", "needReadable", "emittedReadable", "readableListening", "ended", "endEmitted", "flowing", "dataEmitted", "length", "highWaterMark", "bufferIndex"];
const short = value => (value === true ? "1" : value === false ? "0" : value === null ? "n" : value === undefined ? "u" : String(value));
const look = stream => facesOfState.map(face => short(stream._readableState[face])).join(" ") + " | " + stream._readableState.buffer.length;
const shown = value => (value === null ? "null" : Buffer.isBuffer(value) ? "bytes " + value.length : typeof value === "string" ? "text " + value.length : JSON.stringify(value));
function readByHand(name, stream, amounts) {
  return new Promise(resolve => {
    let times = 0;
    stream.on("error", error => lines.push(name + ": error " + error.name));
    stream.on("end", () => {
      lines.push(name + ": end; " + look(stream));
      resolve();
    });
    stream.on("readable", () => {
      for (const amount of amounts) {
        if (times++ > 60) return;
        const before = look(stream);
        let got;
        try {
          got = shown(stream.read(...amount));
        } catch (error) {
          got = "throws " + (error.code ?? error.name);
        }
        lines.push(name + ": read(" + amount.join() + ") " + before + " > " + got + " > " + look(stream));
      }
    });
  });
}
const amounts = [[0], [3], [], [0], []];
module.exports = (async () => {
  const duplex = new Duplex({ read() {}, write(chunk, encoding, done) { this.push(chunk); done(); }, final(done) { this.push(null); done(); } });
  let read = readByHand("a duplex", duplex, amounts);
  duplex.write("made");
  duplex.end("up");
  await read;
  const transform = new Transform({ transform(chunk, encoding, done) { done(null, String(chunk).toUpperCase()); } });
  read = readByHand("a transform", transform, amounts);
  transform.write("made");
  transform.end("up");
  await read;
  const through = new PassThrough({ highWaterMark: 2 });
  read = readByHand("a pass-through with a low mark", through, amounts);
  through.write("made");
  through.end("up");
  await read;
  await readByHand("from a list", Readable.from(["made", "up", "names"]), amounts);
  await readByHand("from a generator", Readable.from((async function* () { yield "made"; yield "up"; })()), amounts);
  await readByHand("a file", createReadStream(__filename, { start: 0, end: 99, highWaterMark: 40 }), amounts);
  await readByHand("a file as text", createReadStream(__filename, { start: 0, end: 99, highWaterMark: 40, encoding: "utf8" }), amounts);
  const gunzip = createGunzip();
  read = readByHand("what is unpacked", gunzip, amounts);
  const gzip = createGzip();
  gzip.pipe(gunzip);
  gzip.end("made up, made up, made up");
  await read;
  await new Promise(resolve => {
    const server = createServer(async (incoming, response) => {
      await readByHand("a request", incoming, amounts);
      response.end("made up and sent back");
    });
    server.listen(0, "127.0.0.1", () => {
      const outgoing = request({ port: server.address().port, host: "127.0.0.1", method: "POST" }, async answer => {
        await readByHand("an answer", answer, amounts);
        server.close(resolve);
      });
      outgoing.end("the body, made up");
    });
  });
  const foreign = vm.runInNewContext("(state => Object.assign(Object.create(null), state))");
  for (const [name, lay] of Object.entries({
    "a proxy as the state": stream => (stream._readableState = new Proxy(stream._readableState, { get(target, key, receiver) { if (key === "length") lines.push("  the proxy is asked for the length"); return Reflect.get(target, key, receiver); } })),
    "an object of another realm as the state": stream => (stream._readableState = foreign(stream._readableState)),
    "an heir of the class of states": stream => {
      const State = stream._readableState.constructor;
      class Heir extends State {}
      stream._readableState = Object.setPrototypeOf(stream._readableState, Heir.prototype);
    },
    "no state": stream => (stream._readableState = undefined),
  })) {
    const stream = new Readable({ read() {} });
    stream.on("error", () => {});
    stream.push("made up");
    lay(stream);
    for (const amount of amounts) {
      let got;
      try {
        got = shown(stream.read(...amount));
      } catch (error) {
        got = "throws " + error.name;
      }
      lines.push(name + ": read(" + amount.join() + ") gives " + got);
    }
  }
  console.log(lines.join("\n"));
})();
process.on("uncaughtException", error => lines.push("nobody catches " + error.name));

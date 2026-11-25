const { Readable, Duplex, PassThrough } = require("node:stream");
const { createServer } = require("node:http");
Function.prototype.madeUp = function () {
  return "made up by " + this.name;
};
const said = [];
const tell = (name, stream) =>
  said.push(
    name + ": " + Object.keys(stream).join() + " | " + Object.getOwnPropertySymbols(stream).map(String).join() + " | " + stream.constructor.madeUp(),
  );
class Heir extends Readable {}
function OldHeir() {
  Readable.call(this);
}
Object.setPrototypeOf(OldHeir.prototype, Readable.prototype);
Object.setPrototypeOf(OldHeir, Readable);
tell("a readable", new Readable());
tell("an heir", new Heir());
tell("an old heir", new OldHeir());
tell("a duplex", new Duplex());
tell("a pass-through", new PassThrough());
tell("with rejections captured", new Readable({ captureRejections: true }));
const server = createServer((request, response) => {
  tell("a request", request);
  request.on("data", () => {});
  request.on("end", () => response.end(request.on.madeUp()));
});
server.listen(0, "127.0.0.1", async () => {
  const address = "http://127.0.0.1:" + server.address().port;
  for (const body of [undefined, "made up"])
    said.push(await (await fetch(address, body === undefined ? {} : { method: "POST", body })).text());
  server.close();
  console.log(said.join("\n"));
});

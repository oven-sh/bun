// The first read of `headers` asks whether a read of `rawHeaders` reaches the library's accessor, and where it does, does not read it. Whatever else a read would find counts: a value, an accessor or nothing, on the request, on a prototype laid between, on each prototype above, or declared by an heir.
const http = require("node:http");
const net = require("node:net");
const { Readable, Stream } = require("node:stream");
const EventEmitter = require("node:events");

const laid = ["X-Made-Up", "laid"];
class Heir extends http.IncomingMessage {}
class HeirThatDeclaresIt extends http.IncomingMessage {
  get rawHeaders() {
    return ["X-Made-Up", "declared"];
  }
  set rawHeaders(value) {}
}
const holders = {
  "the request": req => req,
  "a prototype laid between": req => Object.getPrototypeOf(req),
  "the class": (req, Class) => Class.prototype,
  "IncomingMessage.prototype": () => http.IncomingMessage.prototype,
  "Readable.prototype": () => Readable.prototype,
  "Stream.prototype": () => Stream.prototype,
  "EventEmitter.prototype": () => EventEmitter.prototype,
};

function run(Class, holder, kind, when, between) {
  return new Promise(resolve => {
    const said = [];
    let undo = () => {};
    const lay = object => {
      const before = Object.getOwnPropertyDescriptor(object, "rawHeaders");
      undo = () => {
        try {
          if (before) Object.defineProperty(object, "rawHeaders", before);
          else delete object.rawHeaders;
        } catch {}
      };
      try {
        if (kind === "a stored value") object.rawHeaders = laid;
        else if (kind === "a defined value") Object.defineProperty(object, "rawHeaders", { configurable: true, writable: true, enumerable: true, value: laid });
        else if (kind === "an accessor") Object.defineProperty(object, "rawHeaders", { configurable: true, get: () => laid, set() {} });
        else if (!delete object.rawHeaders) said.push("not deleted");
      } catch (error) {
        said.push("laying throws " + error.constructor.name);
      }
    };
    const middle = Object.create(Class.prototype);
    const isOfOneRequest = holder === "the request" || holder === "a prototype laid between";
    if (!isOfOneRequest && when === "before the server listens") lay(holders[holder](null, Class));
    let turn = 0;
    const server = http.createServer({ IncomingMessage: Class }, (req, res) => {
      turn++;
      if (between) Object.setPrototypeOf(req, middle);
      if (isOfOneRequest ? turn > 1 : when === "in the midst" && turn === 2) lay(holders[holder](req, Class));
      said.push(JSON.stringify(req.headers));
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let got = "";
      let asked = 0;
      const ask = () => (asked++, client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"));
      const finish = tail => {
        client.destroy();
        server.close();
        server.closeAllConnections();
        undo();
        resolve(said.join(" | ") + tail);
      };
      client.on("error", () => {});
      client.on("data", chunk => {
        got += chunk;
        if (got.split("\r\n\r\nok").length - 1 < asked) return;
        if (asked < 3) ask();
        else finish("");
      });
      ask();
    });
  });
}

process.on("uncaughtException", error => console.log("  escaped: " + error.message));
(async () => {
  for (const Class of [http.IncomingMessage, Heir, HeirThatDeclaresIt])
    for (const holder of Object.keys(holders)) {
      if (holder === "the class" && Class === http.IncomingMessage) continue;
      const isOfOneRequest = holder === "the request" || holder === "a prototype laid between";
      for (const kind of ["a stored value", "a defined value", "an accessor", "a delete"])
        for (const when of isOfOneRequest ? ["in the midst"] : ["before the server listens", "in the midst"])
          for (const between of holder === "a prototype laid between" ? [true] : [false, true])
            console.log(`${Class.name} . ${holder} . ${kind} . ${when}${between ? " . re-parented" : ""}: ${await run(Class, holder, kind, when, between)}`);
    }
  process.exit(0);
})();

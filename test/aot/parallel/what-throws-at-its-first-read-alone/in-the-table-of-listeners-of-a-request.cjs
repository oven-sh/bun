// Something of the program's on the road of a request throws at its first read alone, and counts. What it throws is heard where plain Bun lets it be heard, and it is read as often.
const http = require("node:http");
const net = require("node:net");

// Runs the event loop that many times: jobs, errors that nobody handles and what has arrived run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let heard = [];
process.on("uncaughtException", error => heard.push(error.message));

function throwsOnce(object, name, row) {
  let value = object[name];
  Object.defineProperty(object, name, {
    configurable: true,
    enumerable: true,
    get() {
      if (row.reads++ === 0) throw new Error(`made up: ${String(name)}`);
      return value;
    },
    set(next) {
      value = next;
    },
  });
}

const places = {
  "close in the table": (req, row) => throwsOnce(req._events, "close", row),
  "end in the table": (req, row) => throwsOnce(req._events, "end", row),
  "readable in the table": (req, row) => throwsOnce(req._events, "readable", row),
  "resume in the table": (req, row) => throwsOnce(req._events, "resume", row),
  "error in the table": (req, row) => throwsOnce(req._events, "error", row),
  "the state is a Proxy": (req, row) => {
    req._readableState = new Proxy(req._readableState, {
      get(target, key, receiver) {
        if (row.reads++ === 0) throw new Error("made up: the state");
        return Reflect.get(target, key, target);
      },
      set(target, key, value) {
        return Reflect.set(target, key, value, target);
      },
    });
  },
};

const kinds = {
  "untouched, no body": { text: "GET / HTTP/1.1\r\nHost: a\r\n\r\n", handle: (req, res) => res.end("ok") },
  "resumed, no body": { text: "GET / HTTP/1.1\r\nHost: a\r\n\r\n", handle: (req, res) => (req.resume(), res.end("ok")) },
  "left unread, a body": { text: "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nab", handle: (req, res) => res.end("ok") },
  "read, a body": {
    text: "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nab",
    handle: (req, res) => {
      req.on("data", () => {});
      req.on("end", () => res.end("ok"));
    },
  },
};

function run(place, kind) {
  return new Promise(resolve => {
    heard = [];
    const row = { reads: 0 };
    let turn = 0;
    let threw = "";
    const server = http.createServer((req, res) => {
      if (turn++ === 1) places[place](req, row);
      try {
        kinds[kind].handle(req, res);
      } catch (error) {
        threw = ` . the handler caught ${error.message}`;
        try {
          res.end("ok");
        } catch {}
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let answers = 0;
      client.on("error", () => {});
      client.on("data", async () => {
        const answer = ++answers;
        await spinEventLoop();
        if (answer === 1) client.write(kinds[kind].text);
        if (answer !== 2) return;
        client.destroy();
        server.close(async () => {
          await spinEventLoop();
          resolve(`answers ${answers} . heard [${heard.join()}]${threw} . read ${row.reads > 0}`);
        });
        server.closeAllConnections();
      });
      client.write(kinds[kind].text);
    });
  });
}

(async () => {
  for (const place of Object.keys(places)) for (const kind of Object.keys(kinds)) console.log(`${place} | ${kind}: ${await run(place, kind)}`);
  process.exit(0);
})();

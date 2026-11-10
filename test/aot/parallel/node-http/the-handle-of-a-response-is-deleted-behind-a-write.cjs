// A listener writes to its response, takes the symbol of the native handle off the response by reflection, deletes or replaces what lies under it, and ends the response. What was written before has left, whatever becomes of the rest. Each client prints all that it read.
const http = require("node:http");
const net = require("node:net");

let log = [];
process.on("uncaughtException", error => log.push(`uncaught ${error?.name}`));

const deeds = {
  "deleted": (res, symbol) => delete res[symbol],
  "undefined": (res, symbol) => void (res[symbol] = undefined),
  "null": (res, symbol) => void (res[symbol] = null),
  "zero": (res, symbol) => void (res[symbol] = 0),
  "an object": (res, symbol) => void (res[symbol] = {}),
  "defined anew": (res, symbol) =>
    void Object.defineProperty(res, symbol, { value: undefined, writable: true, configurable: true }),
  "only read": (res, symbol) => void res[symbol],
  "asked whether it has sent the head": (res, symbol) => log.push(`flags ${res[symbol].flags}`),
};

const ways = {
  "a text under a Content-Length"(res, turn, between) {
    res.writeHead(200, { "Content-Length": 6 });
    res.write("body ");
    between();
    res.end(String(turn));
  },
  "a text under a Content-Length, and end() without one"(res, turn, between) {
    res.writeHead(200, { "Content-Length": 6 });
    res.write(`body ${turn}`);
    between();
    res.end();
  },
  "a text under a Content-Length, and no end() in this turn"(res, turn, between) {
    res.writeHead(200, { "Content-Length": 6 });
    res.write("body ");
    between();
    setImmediate(() => {
      try {
        res.end(String(turn));
      } catch (error) {
        log.push(`${turn} end() throws ${error.name}`);
        res.req.socket.destroy();
      }
    });
  },
  "chunks"(res, turn, between) {
    res.write("body ");
    between();
    res.end(String(turn));
  },
};

function play(way, deed) {
  return new Promise(resolve => {
    log = [];
    let turn = 0;
    let entered = () => {};
    const server = http.createServer((req, res) => {
      const mine = ++turn;
      entered();
      try {
        ways[way](res, mine, () => {
          if (mine !== 2) return;
          for (const symbol of Object.getOwnPropertySymbols(res)) {
            if (symbol.description === "handle") deeds[deed](res, symbol);
          }
        });
      } catch (error) {
        log.push(`${mine} throws ${error.name}`);
        setImmediate(() => req.socket.destroy());
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let wire = "";
      let asked = 0;
      let answered = 0;
      const read = () => JSON.stringify(wire.replace(/Date: [^\r]*\r\n/, ""));
      // A request goes out by one write, so all of it has come once the listener is entered. What the server still does from there is work of this process alone, and takes the same
      // turns of the loop however busy the machine is. What it has written by then is in the hands of the kernel, and a kernel that carries the packets of the loopback on a thread of
      // its own (macOS) may bring a whole answer later than any number of turns. This connection is asked again behind a whole answer, so the client must not end its half in front of
      // one: it waits a quarter of a second for it, and looks a few turns behind each timer, where a process that was stopped meanwhile finds what has come. Then the client ends its
      // half of the connection, the server closes, and whatever was written comes in front of the close.
      const ask = () => {
        const mine = ++asked;
        wire = "";
        entered = async () => {
          for (let i = 0; i < 16; i++) await new Promise(setImmediate);
          for (let wait = 0; wait < 25 && answered < mine && !client.destroyed; wait++) {
            await new Promise(resolve => setTimeout(resolve, 10));
            for (let i = 0; i < 4; i++) await new Promise(setImmediate);
          }
          if (answered < mine && !client.destroyed) client.end();
        };
        client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      };
      client.on("data", piece => {
        wire += piece.toString("latin1");
        if (!/body \d$|\r\n0\r\n\r\n$/.test(wire)) return;
        log.push(`${asked} ${read()}`);
        answered = asked;
        wire = "";
        if (asked < 3) setImmediate(ask);
        else client.destroy();
      });
      client.on("error", error => log.push(`client ${error.code}`));
      client.on("close", () => {
        if (wire) log.push(`${asked} cut off behind ${read()}`);
        else if (asked < 3) log.push(`${asked} nothing`);
        // The server has closed once its side of the connection has: what that brings is told too.
        const late = setTimeout(() => server.closeAllConnections(), 300);
        server.close(() => {
          clearTimeout(late);
          setImmediate(() => resolve(log.join(", ")));
        });
      });
      ask();
    });
  });
}

(async () => {
  for (const way of Object.keys(ways)) {
    for (const deed of Object.keys(deeds)) console.log(`${way}, ${deed}: ${await play(way, deed)}`);
  }
  process.exit(0);
})();

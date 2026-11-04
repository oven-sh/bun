// A program takes the symbols that node:http lays on the socket of a connection off it by reflection, and in the listener of the second request deletes or replaces what lies under them. Two more requests follow on the connection. Then the client closes it, or cuts a request off in its body, or leaves it idle until the server closes it.
const http = require("node:http");
const net = require("node:net");

let log = [];
// What the library throws outside of a listener is told by its name: its text and its frames are the library's own.
process.on("uncaughtException", error => log.push(`uncaught ${error?.name}`));

const deeds = {
  "deleted": (socket, symbol) => delete socket[symbol],
  "undefined": (socket, symbol) => void (socket[symbol] = undefined),
  "null": (socket, symbol) => void (socket[symbol] = null),
  "zero": (socket, symbol) => void (socket[symbol] = 0),
  "an object": (socket, symbol) => void (socket[symbol] = {}),
  "a timer of the program": (socket, symbol) => void (socket[symbol] = setTimeout(() => {}, 100000).unref()),
  "defined anew": (socket, symbol) =>
    void Object.defineProperty(socket, symbol, { value: undefined, writable: true, configurable: true }),
  "cleared": (socket, symbol) => void clearTimeout(socket[symbol]),
  "only read": (socket, symbol) => void socket[symbol],
};

// Those that a socket gets while it serves, and those under which the library looks once for a connection.
const late = ["keepAliveTimeoutSet", "socketTimeoutTimer", "request", "closeCallback", "kStopParsingOnCloseListener"];
const early = ["kStreamingEnabled", "kBoundOnAbort", "http.server.socketHandedOff", "keepAliveIdleStart", "handle"];

function play(names, deed, stage, method, ending) {
  return new Promise(resolve => {
    log = [];
    let turn = 0;
    let cutOff = () => {};
    const act = socket => {
      for (const symbol of Object.getOwnPropertySymbols(socket)) {
        if (!names.includes(symbol.description)) continue;
        try {
          deeds[deed](socket, symbol);
        } catch (error) {
          log.push(`the deed throws ${error.name}`);
        }
      }
    };
    const told = socket =>
      Object.getOwnPropertySymbols(socket)
        .map(symbol => symbol.description)
        .filter(name => late.includes(name))
        .sort()
        .join(" ");
    const server = http.createServer((req, res) => {
      const mine = ++turn;
      const answer = () => {
        try {
          res.end(`body ${mine}`);
        } catch (error) {
          log.push(`${mine} end() throws ${error.name}`);
          req.socket.destroy();
        }
        if (mine === 2 && stage === "last") act(req.socket);
      };
      if (mine === 2 && stage === "first") act(req.socket);
      // No clock runs against the requests: the short times begin behind the last of them.
      if (mine === 2 && ending === "idle under a timeout of the server") server.timeout = 60;
      if (mine === 3 && ending.startsWith("idle")) {
        server.keepAliveTimeout = 30;
        server.keepAliveTimeoutBuffer = 0;
      }
      if (mine === 3) log.push(`has ${told(req.socket)}, ${req.socket.listenerCount("close")} listeners of 'close'`);
      if (mine === 4 && ending === "cut off") {
        for (const event of ["aborted", "error", "close"]) req.on(event, () => log.push(`request ${event}`));
        res.on("close", () => log.push("response close"));
        req.resume();
        return void setImmediate(cutOff);
      }
      if (req.method === "GET") return answer();
      req.on("data", () => {}).on("end", answer);
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let wire = "";
      let asked = 0;
      let watchdog;
      // A machine that stalls lets every clock run out at once: the verdict waits for what has arrived meanwhile.
      const wait = (what, after) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          watchdog = setTimeout(() => (log.push(what), client.destroy()), 30);
        }, after);
      };
      cutOff = () => client.destroy();
      const ask = () => {
        asked++;
        wire = "";
        if (asked === 4 && ending === "closed") return void client.destroy();
        if (asked === 4 && ending === "cut off") {
          return void client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 10\r\n\r\nhi");
        }
        if (asked === 4) return wait("the connection stays open", 300);
        client.write(
          method === "POST"
            ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi"
            : "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
        );
        wait(`${asked} no answer`, 300);
      };
      client.on("data", piece => {
        wire += piece.toString("latin1");
        const answer = /^HTTP\/1\.1 (\d+)[^]*\r\n\r\n(body \d)$/.exec(wire);
        if (!answer) return;
        log.push(`${asked} ${answer[1]} ${answer[2]}`);
        setImmediate(ask);
      });
      client.on("error", error => log.push(`client ${error.code}`));
      client.on("end", () => log.push(`the server ends the connection behind ${asked - 1}`));
      client.on("close", () => {
        clearTimeout(watchdog);
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
  const tell = async (what, names, deed, stage, method, ending) =>
    console.log(`${what} ${deed}, ${method}, ${stage}, ${ending}: ${await play(names, deed, stage, method, ending)}`);
  for (const deed of Object.keys(deeds)) {
    for (const method of ["GET", "POST"]) {
      for (const name of late) await tell(`@${name}`, [name], deed, "last", method, "closed");
      for (const stage of ["first", "last"]) await tell("all that come late", late, deed, stage, method, "closed");
    }
    for (const name of early) await tell(`@${name}`, [name], deed, "last", "GET", "closed");
    await tell("@socketTimeoutTimer", ["socketTimeoutTimer"], deed, "last", "GET", "idle");
    await tell(
      "@socketTimeoutTimer",
      ["socketTimeoutTimer"],
      deed,
      "last",
      "GET",
      "idle under a timeout of the server",
    );
    await tell("all that come late", late, deed, "last", "GET", "idle");
    await tell("@kBoundOnAbort", ["kBoundOnAbort"], deed, "last", "GET", "cut off");
    await tell("all that come late", late, deed, "last", "GET", "cut off");
  }
  process.exit(0);
})();

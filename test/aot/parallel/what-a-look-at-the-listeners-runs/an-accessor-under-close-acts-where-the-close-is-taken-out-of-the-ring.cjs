// The server's finish may take the queued close of a request out of the ring of next ticks and run it at once. An accessor under `close` in the table of listeners sees when it is looked at and lays a writable side on the request.
const http = require("node:http");
const net = require("node:net");

const ways = {
  "at once": answer => answer(),
  "in a next tick": answer => process.nextTick(answer),
  "in a microtask": answer => queueMicrotask(answer),
  "behind two awaits": async answer => {
    await undefined;
    await undefined;
    answer();
  },
  "in a next tick out of a microtask": answer => queueMicrotask(() => process.nextTick(answer)),
  "in an immediate": answer => setImmediate(answer),
};

function run(way, headers) {
  return new Promise(resolve => {
    const said = [];
    const server = http.createServer((req, res) => {
      const side = {};
      const row = [];
      said.push(row);
      Object.defineProperty(req._events, "close", {
        configurable: true,
        enumerable: true,
        get() {
          row.push(`closed ${req.closed}`);
          req._writableState = side;
          return undefined;
        },
        set() {},
      });
      req.on("data", () => {});
      req.on("end", () =>
        ways[way](() => {
          if (headers) res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
          res.end("ok");
        }),
      );
      setTimeout(() => row.push(`marks ${Object.getOwnPropertySymbols(side).length}`, `closed ${req.closed}`), 30);
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let asked = 0;
      let timer;
      const ask = () => {
        asked++;
        client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nab");
      };
      client.on("data", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (asked < 3) return ask();
          client.destroy();
          server.close();
          resolve(said.map(row => [...new Set(row)].join(",")).join(" | "));
        }, 70);
      });
      ask();
    });
  });
}

(async () => {
  for (const way of Object.keys(ways)) for (const headers of [false, true]) console.log(way, headers ? "with a head" : "", ":", await run(way, headers));
  process.exit(0);
})();

// Whether header values are validated leniently is settled at the first header: the response is asked for `httpValidation`, then its request, the socket and the server, then the response for `insecureHTTPParser`. An accessor of the program's on that way lays an option on the response: `httpValidation` comes too late for this header, `insecureHTTPParser` in time. Four requests with a valid header come first, so that the name is an expected one.
const http = require("node:http");
const net = require("node:net");

function run(where, option) {
  return new Promise(resolve => {
    const said = [];
    let turn = 0;
    const server = http.createServer((req, res) => {
      const lay = () => {
        if (option === "httpValidation") res.httpValidation = "relaxed";
        else res.insecureHTTPParser = true;
      };
      if (++turn > 4) {
        if (where === "req on the response") {
          Object.defineProperty(res, "req", { configurable: true, get: () => (lay(), req), set() {} });
        } else if (where === "socket on the request") {
          const socket = req.socket;
          Object.defineProperty(req, "socket", { configurable: true, get: () => (lay(), socket), set() {} });
        } else if (where === "server on the socket") {
          const held = req.socket.server;
          Object.defineProperty(req.socket, "server", { configurable: true, get: () => (lay(), held), set() {} });
        } else if (where === "httpValidation on the server") {
          Object.defineProperty(server, "httpValidation", { configurable: true, get: () => (lay(), undefined), set() {} });
        } else if (where === "no socket on the request") {
          Object.defineProperty(req, "socket", { configurable: true, get: () => (lay(), null), set() {} });
        }
      }
      try {
        res.setHeader("x-made-up", turn > 4 ? "a\u0001b" : "fine");
        said.push("stored");
      } catch (error) {
        said.push(error.code);
      }
      res.removeHeader("x-made-up");
      if (where === "no socket on the request") delete req.socket;
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let asked = 0;
      let timer;
      const ask = () => {
        asked++;
        client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      };
      client.on("error", () => {});
      client.on("data", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (asked < 7) return ask();
          client.destroy();
          server.close();
          resolve(said.join(" "));
        }, 40);
      });
      ask();
    });
  });
}

(async () => {
  for (const option of ["httpValidation", "insecureHTTPParser"]) for (const where of ["nowhere", "req on the response", "socket on the request", "server on the socket", "httpValidation on the server", "no socket on the request"]) console.log(`${option} laid by ${where}: ${await run(where, option)}`);
  process.exit(0);
})();

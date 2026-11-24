// Whether header values are validated leniently is settled at the first header: the response is asked, then its request, the socket and the server, then the response again. An accessor of the program's on that way lays the option on the response: it is honored.
const http = require("node:http");
const net = require("node:net");

function run(where) {
  return new Promise(resolve => {
    const said = [];
    const server = http.createServer((req, res) => {
      const lay = () => {
        res.insecureHTTPParser = true;
      };
      if (where === "socket on the request") {
        const socket = req.socket;
        Object.defineProperty(req, "socket", { configurable: true, get: () => (lay(), socket), set() {} });
      } else if (where === "server on the socket") {
        const held = req.socket.server;
        Object.defineProperty(req.socket, "server", { configurable: true, get: () => (lay(), held), set() {} });
      } else if (where === "httpValidation on the server") {
        Object.defineProperty(server, "httpValidation", { configurable: true, get: () => (lay(), undefined), set() {} });
      } else if (where === "req on the response") {
        Object.defineProperty(res, "req", { configurable: true, get: () => (lay(), req), set() {} });
      }
      try {
        res.setHeader("x-made-up", "a\u0001b");
        said.push("stored");
      } catch (error) {
        said.push(error.code);
      }
      res.removeHeader("x-made-up");
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
          if (asked < 3) return ask();
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
  for (const where of ["nowhere", "req on the response", "socket on the request", "server on the socket", "httpValidation on the server"]) console.log(where, ":", await run(where));
  process.exit(0);
})();

// A request that is resumed resumes its socket first and says `resume` behind that. A resume() of the program's on the socket, its own or on a prototype laid between, adds a listener of `resume` to the request: it is heard.
const http = require("node:http");
const net = require("node:net");

function run(where, reads, hasBody) {
  return new Promise(resolve => {
    const log = [];
    let current;
    const act = () => {
      const req = current;
      current = undefined;
      if (req) req.on("resume", () => log.push("resume"));
    };
    const server = http.createServer((req, res) => {
      if (where === "its own" && !req.socket.isLaid) {
        req.socket.isLaid = true;
        const resume = req.socket.resume;
        req.socket.resume = function () {
          act();
          return resume.call(this);
        };
      }
      current = req;
      if (reads) {
        req.on("data", chunk => log.push("data " + chunk.length));
        req.on("end", () => {
          log.push("end");
          res.end("ok");
        });
      } else res.end("ok");
    });
    if (where === "laid between") {
      server.on("connection", socket => {
        const above = Object.getPrototypeOf(socket);
        Object.setPrototypeOf(
          socket,
          Object.create(above, {
            resume: {
              value() {
                act();
                return above.resume.call(this);
              },
            },
          }),
        );
      });
    }
    const text = hasBody ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello" : "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      let turns = 0;
      let timer;
      client.on("error", () => {});
      client.on("data", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (++turns < 2) return client.write(text);
          client.destroy();
          server.close();
          resolve(log.join(" | "));
        }, 40);
      });
      client.write(text);
    });
  });
}

(async () => {
  for (const where of ["its own", "laid between"]) {
    for (const [reads, hasBody] of [
      [false, false],
      [false, true],
      [true, true],
      [true, false],
    ]) {
      console.log(where, reads ? "read" : "left unread", hasBody ? "with a body" : "without a body", ":", await run(where, reads, hasBody));
    }
  }
  process.exit(0);
})();

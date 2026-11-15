// A listener calls destroySoon() on the socket before, between or behind the calls that write the response. A response that ends on a connection that is closing emits no 'finish', its request is aborted, and write() says false.
const http = require("node:http");
const net = require("node:net");

let log = [];
const five = { "Content-Length": 5 };

const forms = {
  "soon, end(text)"(req, res) {
    res.socket.destroySoon();
    res.end("hello");
  },
  "soon, end()"(req, res) {
    res.socket.destroySoon();
    res.end();
  },
  "soon, end(text, callback)"(req, res) {
    res.socket.destroySoon();
    res.end("hello", () => log.push("callback"));
  },
  "soon, end(bytes)"(req, res) {
    res.socket.destroySoon();
    res.end(Buffer.from("hello"));
  },
  "soon, head, text, end()"(req, res) {
    res.socket.destroySoon();
    res.writeHead(200, five);
    log.push("write " + res.write("hello"));
    res.end();
  },
  "soon, head, text"(req, res) {
    res.socket.destroySoon();
    res.writeHead(200, five);
    log.push("write " + res.write("hello"));
  },
  "soon, text, end()"(req, res) {
    res.socket.destroySoon();
    log.push("write " + res.write("hello"));
    res.end();
  },
  "soon, flushHeaders(), end(text)"(req, res) {
    res.socket.destroySoon();
    res.flushHeaders();
    res.end("hello");
  },
  "soon, soon, end(text)"(req, res) {
    res.socket.destroySoon();
    res.socket.destroySoon();
    res.end("hello");
  },
  "soon through the request, end(text)"(req, res) {
    req.socket.destroySoon();
    res.end("hello");
  },
  "soon"(req, res) {
    res.socket.destroySoon();
  },
  "head, text, soon, end()"(req, res) {
    res.writeHead(200, five);
    res.write("hello");
    res.socket.destroySoon();
    res.end();
  },
  "head, text, soon"(req, res) {
    res.writeHead(200, five);
    res.write("hello");
    res.socket.destroySoon();
  },
  "text, soon, end(text)"(req, res) {
    res.write("he");
    res.socket.destroySoon();
    res.end("llo");
  },
  "end(text), soon"(req, res) {
    res.end("hello");
    res.socket.destroySoon();
  },
  "a tick later: soon, end(text)"(req, res) {
    process.nextTick(() => {
      res.socket.destroySoon();
      res.end("hello");
    });
  },
  "an immediate later: soon, end(text)"(req, res) {
    setImmediate(() => {
      res.socket.destroySoon();
      res.end("hello");
    });
  },
  "soon, a tick later end(text)"(req, res) {
    res.socket.destroySoon();
    process.nextTick(() => res.end("hello"));
  },
  "soon, an immediate later end(text)"(req, res) {
    res.socket.destroySoon();
    setImmediate(() => res.end("hello"));
  },
  "socket.end(), end(text)"(req, res) {
    res.socket.end();
    res.end("hello");
  },
  "socket.destroy(), end(text)"(req, res) {
    res.socket.destroy();
    res.end("hello");
  },
};

const warmUp = "GET /warm-up HTTP/1.1\r\nHost: a\r\n\r\n";
const requests = {
  GET: "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
  POST: "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi",
};

function play(form, method, warmUps) {
  const { promise, resolve } = Promise.withResolvers();
  log = [];
  let state = () => "never asked";
  const server = http.createServer((req, res) => {
    if (req.url === "/warm-up") return void res.end("ok");
    for (const event of ["prefinish", "finish", "close"]) res.on(event, () => log.push("res " + event));
    res.on("error", error => log.push("res error " + error.code));
    for (const event of ["end", "aborted", "close"]) req.on(event, () => log.push("req " + event));
    req.on("error", error => log.push("req error " + error.code));
    state = () =>
      [res.finished, res.writableFinished, res.headersSent, res.destroyed, req.destroyed, req.complete].join(" ");
    forms[form](req, res);
  });
  server.listen(0, "127.0.0.1", () => {
    const client = net.connect(server.address().port, "127.0.0.1");
    let wire = "";
    let left = warmUps;
    client.on("data", bytes => {
      wire += bytes.toString("latin1");
      if (left === 0 || !wire.endsWith("ok")) return;
      wire = "";
      client.write(--left > 0 ? warmUp : requests[method]);
    });
    client.on("error", error => log.push("client " + error.code));
    client.on("close", () => {
      server.close(() =>
        setImmediate(() =>
          resolve(`${log.join(", ")} | ${JSON.stringify(wire.replace(/date: [^\r]*\r\n/gi, ""))} | ${state()}`),
        ),
      );
      server.closeAllConnections();
    });
    client.write(left > 0 ? warmUp : requests[method]);
  });
  return promise;
}

(async () => {
  for (const form of Object.keys(forms)) {
    for (const method of Object.keys(requests)) {
      for (const warmUps of [0, 1]) {
        console.log(`${form}, ${method} behind ${warmUps}: ${await play(form, method, warmUps)}`);
      }
    }
  }
})();

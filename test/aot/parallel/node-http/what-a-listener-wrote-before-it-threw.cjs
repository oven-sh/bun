// A listener writes to the response in fourteen ways and throws. What it wrote reaches the client, whichever event of the server handed it the response: 'request' with and without an Expect header, 'checkContinue', 'checkExpectation', 'dropRequest'.
const http = require("node:http");
const net = require("node:net");

let log = [];
process.on("uncaughtException", error => log.push("uncaught " + (error.message ?? error)));

const writes = {
  "head and text"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write("failed");
  },
  "header and text"(res) {
    res.statusCode = 500;
    res.setHeader("Content-Length", 6);
    res.write("failed");
  },
  "part of the length"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write("fai");
  },
  "a text of three bytes a character at most"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write("f\u00e9\u20ac");
  },
  "the longest text that write() may keep"(res) {
    res.writeHead(500, { "Content-Length": 21845 });
    res.write("f".repeat(21845));
  },
  "an empty text"(res) {
    res.writeHead(500, { "Content-Length": 0 });
    res.write("");
  },
  "head with a message and text"(res) {
    res.writeHead(500, "Broken", { "Content-Length": 6 });
    res.write("failed");
  },
  "header and text, then another status"(res) {
    res.statusCode = 500;
    res.setHeader("Content-Length", 6);
    res.write("failed");
    res.statusCode = 201;
  },
  "head and text, and what is thrown is no error"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write("failed");
    throw "no error";
  },
  "two texts"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write("fai");
    res.write("led");
  },
  "bytes"(res) {
    res.writeHead(500, { "Content-Length": 6 });
    res.write(Buffer.from("failed"));
  },
  "no length"(res) {
    res.writeHead(500);
    res.write("failed");
  },
  "head alone"(res) {
    res.writeHead(500, { "Content-Length": 6 });
  },
  "nothing"() {},
};

const expectations = {
  request: "",
  "request behind Expect": "Expect: 100-continue\r\n",
  checkContinue: "Expect: 100-continue\r\n",
  checkExpectation: "Expect: the-unexpected\r\n",
  dropRequest: "",
};

const warmUp = "GET /warm-up HTTP/1.1\r\nHost: a\r\n\r\n";

function play(event, what, warmUps) {
  const { promise, resolve } = Promise.withResolvers();
  log = [];
  const listener = (req, res) => {
    if (req.url === "/warm-up") return void res.end("ok");
    writes[what](res);
    throw new Error("boom");
  };
  const server = http.createServer(listener);
  if (event === "checkContinue" || event === "checkExpectation") server.on(event, listener);
  if (event === "dropRequest") {
    server.maxRequestsPerSocket = warmUps;
    server.on("dropRequest", (req, socket) => listener(req, socket._httpMessage));
  }
  server.listen(0, "127.0.0.1", () => {
    const client = net.connect(server.address().port, "127.0.0.1");
    const last = `POST / HTTP/1.1\r\nHost: a\r\n${expectations[event]}Content-Length: 2\r\n\r\nhi`;
    let wire = "";
    let left = warmUps;
    client.on("data", bytes => {
      wire += bytes.toString("latin1");
      if (left === 0 || !wire.endsWith("ok")) return;
      wire = "";
      client.write(--left > 0 ? warmUp : last);
    });
    client.on("error", error => log.push("client " + error.code));
    client.on("close", () => {
      const seen = wire.replace(/date: [^\r]*\r\n/gi, "").replace(/f{9,}/, all => `f, ${all.length} times`);
      server.close(() => resolve(`${log.join(", ")} ${JSON.stringify(seen)}`));
      server.closeAllConnections();
    });
    client.write(left > 0 ? warmUp : last);
  });
  return promise;
}

(async () => {
  for (const event of Object.keys(expectations)) {
    for (const what of Object.keys(writes)) {
      for (const warmUps of event === "dropRequest" ? [1, 2] : [0, 1]) {
        console.log(`${event}, ${what}, behind ${warmUps}: ${await play(event, what, warmUps)}`);
      }
    }
  }
})();

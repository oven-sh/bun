// The members of a response that decide how it is framed: Date, Connection, Keep-Alive, Transfer-Encoding. An accessor of the program
// under one of them sees each read and store of the server, whatever it answers with, however the response is sent.
const http = require("node:http");

const names = [
  "sendDate",
  "useChunkedEncodingByDefault",
  "_hasBody",
  "_removedTE",
  "_removedContLen",
  "_removedConnection",
  "maxRequestsOnConnectionReached",
  "_keepAliveTimeout",
  "_maxRequestsPerSocket",
  "strictContentLength",
];
const answers = {
  "what it holds": held => held,
  "the other boolean": held => (typeof held === "boolean" ? !held : held),
  "nothing": () => undefined,
};
const ways = {
  end: res => res.end("ok"),
  head(res) {
    res.writeHead(200, { "Content-Length": 2 });
    res.end("ok");
  },
  write(res) {
    res.write("o");
    res.end("k");
  },
  header(res) {
    res.setHeader("x-a", "1");
    res.end("ok");
  },
  empty: res => res.end(),
};

const lines = [];
let step;
const server = http.createServer((req, res) => {
  const [name, answer, way] = step;
  let held = res[name];
  let trail = "";
  Object.defineProperty(res, name, {
    get() {
      trail += "g";
      return answers[answer](held);
    },
    set(value) {
      trail += "s";
      held = value;
    },
    configurable: true,
    enumerable: true,
  });
  res.on("close", () => setImmediate(() => lines.push(step.join(" | ") + " | " + trail)));
  try {
    ways[way](res);
  } catch (error) {
    lines.push(step.join(" | ") + " throws " + error.name + ": " + error.message);
    delete res[name];
    res.end();
  }
});
const keepAlive = new http.Agent({ keepAlive: true, maxSockets: 1 });
function ask(port, agent) {
  return new Promise(resolve => {
    const request = http.get({ port, host: "127.0.0.1", agent }, response => {
      let text = "";
      response.on("data", piece => (text += piece));
      response.on("end", () => {
        const { connection, date } = response.headers;
        const framing = response.headers["transfer-encoding"] ?? response.headers["content-length"];
        lines.push(
          ["  " + response.statusCode, connection, typeof date, response.headers["keep-alive"], framing, text].join(
            " ",
          ),
        );
        setImmediate(() => setImmediate(resolve));
      });
    });
    request.on("error", error => {
      lines.push("  the request fails: " + error.code);
      setImmediate(() => setImmediate(resolve));
    });
  });
}
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (const [connection, agent] of [
    ["closes", false],
    ["stays", keepAlive],
  ]) {
    for (const name of names) {
      for (const answer in answers) {
        for (const way in ways) {
          // A response that is framed for a body and sends none leaves the client waiting.
          if (name === "_hasBody" && answer !== "what it holds") continue;
          step = [name, answer, way, connection];
          await ask(port, agent);
        }
      }
    }
  }
  keepAlive.destroy();
  server.close(() => console.log(lines.join("\n")));
});

// `res.statusMessage` may be an object: native code asks it for its text amid the call that sends the head. What its toString does there is honored.
// Each row has a connection of its own. How often the text is asked for is not printed.
const http = require("node:http");
const net = require("node:net");
const calls = {
  'end("x")': res => res.end("x"),
  "end()": res => res.end(),
  'write("x")': res => res.write("x"),
  "writeHead(200)": res => res.writeHead(200) === res,
  "flushHeaders()": res => res.flushHeaders(),
};
const deeds = {
  nothing() {},
  "sets a header": res => res.setHeader("X-Amid", "1"),
  writes: res => res.write("in"),
  ends: res => res.end("zz"),
  "ends and throws"(res) {
    res.end("zz");
    throw new RangeError("made up");
  },
  throws() {
    throw new RangeError("made up");
  },
  "destroys the response": res => res.destroy(),
  "destroys the connection": res => res.socket.destroy(),
};
const rows = [];
for (const call in calls) for (const deed in deeds) rows.push([call, deed]);
const tell = error => error.name + " " + (error.code ?? error.message);
let row;
let said = [];
process.on("uncaughtException", error => said.push("uncaught " + tell(error)));
const server = http.createServer((req, res) => {
  const [call, deed] = row;
  let acted = false;
  res.on("error", error => said.push("error " + tell(error)));
  res.statusMessage = {
    toString() {
      if (!acted) {
        acted = true;
        deeds[deed](res);
      }
      return "Made Up";
    },
  };
  try {
    said.push("call " + String(calls[call](res)));
  } catch (error) {
    said.push("call threw " + tell(error));
  }
  said.push("sent " + res.headersSent + " finished " + res.finished + " destroyed " + res.destroyed);
  if (!res.finished && !res.destroyed) {
    try {
      res.end("!");
    } catch (error) {
      said.push("end threw " + tell(error));
    }
  }
});
function next() {
  if (rows.length === 0) {
    server.close();
    return void server.closeAllConnections();
  }
  row = rows.shift();
  said = [];
  let text = "";
  const client = net.connect(server.address().port, "127.0.0.1", () =>
    client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"),
  );
  client.on("data", bytes => (text += bytes));
  client.on("error", () => {});
  const timer = setTimeout(() => {
    said.push("no end");
    client.destroy();
  }, 600);
  client.on("close", () =>
    setTimeout(() => {
      clearTimeout(timer);
      const [head, ...body] = text.split("\r\n\r\n");
      const lines = head.split("\r\n").filter(line => !/^date:/i.test(line));
      console.log(row.join(" . ") + ": " + said.join(" | ") + " | " + JSON.stringify(lines.join(";")) + " " + JSON.stringify(body.join("\r\n\r\n")));
      next();
    }, 5),
  );
}
server.listen(0, "127.0.0.1", next);

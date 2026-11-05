// A map of headers stored before the first header.
// Flags: --aot-testing=FailPredictions:7:2 --aot-validate
const http = require("node:http");
const net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");

const lines = [];
const show = value => JSON.stringify(value) ?? String(value);
const attempt = action => {
  try {
    return show(action());
  } catch (error) {
    return "threw " + error.name + " " + error.code;
  }
};
const newMap = () => ({ __proto__: null, "x-two": ["X-Two", "2"], "x-list": ["X-List", ["a", "b"]] });

const steps = {
  nothing() {},
  getHeaders: message => message.getHeaders(),
  getHeaderNames: message => message.getHeaderNames(),
  getRawHeaderNames: message => message.getRawHeaderNames(),
  getHeader: message => [message.getHeader("x-two"), message.getHeader("X-List"), message.getHeader("x-none")],
  hasHeader: message => [message.hasHeader("x-two"), message.hasHeader("X-LIST"), message.hasHeader("x-none")],
  removeHeader: message => (message.removeHeader("X-Two"), message.getHeaders()),
  removeBoth: message => (message.removeHeader("x-two"), message.removeHeader("x-list"), message.getHeaders()),
  appendHeader: message => (message.appendHeader("x-two", "3"), message.getHeaders()),
  appendNew: message => (message.appendHeader("X-New", "n"), message.getHeaders()),
  setHeader: message => (message.setHeader("X-Three", "3"), message.getHeaders()),
  setSame: message => (message.setHeader("X-TWO", "again"), [message.getHeaders(), message.getRawHeaderNames()]),
  setHeaders: message => (message.setHeaders(new Map([["X-Four", "4"]])), message.getHeaders()),
  contentLength: (message, length) => (
    (message[kOutHeaders]["content-length"] = ["Content-Length", String(length)]),
    message.getHeaders()
  ),
  connectionClose: message => ((message[kOutHeaders].connection = ["Connection", "close"]), message.getHeaders()),
  date: message => ((message[kOutHeaders].date = ["Date", "then"]), message.getHeaders()),
  anotherMap: message => (
    (message[kOutHeaders] = { __proto__: null, "x-five": ["X-Five", "5"] }),
    message.getHeaders()
  ),
  backToNull: message => (
    (message[kOutHeaders] = null),
    [message.getHeaders(), message.getHeaderNames(), message.hasHeader("x-two")]
  ),
  theMapItself: message => message[kOutHeaders],
};
const endings = {
  end: res => res.end("ok"),
  writeThenEnd: res => (res.write("o"), res.end("k")),
  writeHead: res => (res.writeHead(201, { "X-Six": "6" }), res.end("ok")),
  writeHeadList: res => (res.writeHead(202, ["X-Seven", "7"]), res.end("ok")),
  flushHeaders: res => (res.flushHeaders(), res.end("ok")),
  endWithoutBody: res => res.end(),
};

for (const [name, make] of Object.entries({
  "a response made by hand": () => new http.ServerResponse(new http.IncomingMessage(new net.Socket())),
  "a message made by hand": () => new http.OutgoingMessage(),
})) {
  for (const step in steps) {
    const message = make();
    message[kOutHeaders] = newMap();
    lines.push(
      name + " " + step + ": " + attempt(() => steps[step](message, 2)) + " | " + attempt(() => message[kOutHeaders]),
    );
  }
}

const server = http.createServer((req, res) => {
  const [, step, ending] = req.url.split("/");
  res[kOutHeaders] = newMap();
  lines.push(
    req.url +
      ": " +
      attempt(() => steps[step](res, ending === "endWithoutBody" ? 0 : 2)) +
      " | " +
      attempt(() => res[kOutHeaders]),
  );
  endings[ending](res);
  lines.push(req.url + " behind: " + attempt(() => res.getHeaders()) + " " + res.headersSent);
});
server.listen(0, async () => {
  const names = [
    "x-two",
    "x-list",
    "x-new",
    "x-three",
    "x-four",
    "x-five",
    "x-six",
    "x-seven",
    "content-length",
    "connection",
    "transfer-encoding",
  ];
  for (const step in steps) {
    for (const ending in endings) {
      try {
        const response = await fetch("http://127.0.0.1:" + server.address().port + "/" + step + "/" + ending);
        const body = await response.text();
        const date = response.headers.get("date");
        lines.push(
          "  " +
            response.status +
            " " +
            names.map(name => name + "=" + response.headers.get(name)).join(" ") +
            " date=" +
            (date === "then" ? date : typeof date) +
            " " +
            show(body),
        );
      } catch (error) {
        lines.push("  the client: " + error.code);
      }
    }
  }
  console.log(lines.join("\n"));
  server.close();
});

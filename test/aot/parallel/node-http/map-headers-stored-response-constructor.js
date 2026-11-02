// A map of headers stored on a response whose constructor calls server response.
const http = require("node:http");
const net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");

const lines = [];
const show = value => JSON.stringify(value) ?? String(value);
const newMap = () => ({ __proto__: null, "x-two": ["X-Two", "2"], "x-list": ["X-List", ["a", "b"]] });

class Heir extends http.ServerResponse {}
function Caller(req, options) {
  http.ServerResponse.call(this, req, options);
}
Object.setPrototypeOf(Caller.prototype, http.ServerResponse.prototype);
Object.setPrototypeOf(Caller, http.ServerResponse);

const look = (name, message) => {
  message[kOutHeaders] = newMap();
  const seen = [
    message.getHeaders(),
    message.getHeaderNames(),
    message.getRawHeaderNames(),
    message.getHeader("x-two"),
  ];
  lines.push(name + ": " + show(seen) + " | " + show(message[kOutHeaders]));
};

const classes = [http.ServerResponse, Heir, Caller];
for (const Response of classes) {
  for (let i = 0; i < 40; i++)
    look(Response.name + " by hand " + i, new Response(new http.IncomingMessage(new net.Socket())));
}

async function serve(ServerResponse) {
  const server = http.createServer({ ServerResponse }, (req, res) => {
    look(req.url, res);
    res.end("ok");
  });
  await new Promise(resolve => server.listen(0, resolve));
  for (let i = 0; i < 40; i++) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/" + ServerResponse.name + "/" + i);
    lines.push(
      "  " + response.headers.get("x-two") + " " + response.headers.get("x-list") + " " + (await response.text()),
    );
  }
  await new Promise(resolve => server.close(resolve));
}

(async () => {
  for (const Response of classes) await serve(Response);
  console.log(lines.join("\n"));
})();

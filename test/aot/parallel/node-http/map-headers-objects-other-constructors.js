// The map of headers of objects that other constructors hand to server response.
const http = require("node:http");
const net = require("node:net");
const { kOutHeaders } = require("node:_http_outgoing");

const lines = [];
const show = value => JSON.stringify(value) ?? String(value);
const newMap = () => ({ __proto__: null, "x-two": ["X-Two", "2"], "x-list": ["X-List", ["a", "b"]] });

function Calls(req, options) {
  http.ServerResponse.call(this, req, options);
}
function CallsAndStores(req, options) {
  http.ServerResponse.call(this, req, options);
  this.stored = 1;
}
function StoresAndCalls(req, options) {
  this.stored = 1;
  http.ServerResponse.call(this, req, options);
}
function AppliesByReflect(req, options) {
  Reflect.apply(http.ServerResponse, this, [req, options]);
}
function Applies(req, options) {
  http.ServerResponse.apply(this, arguments);
}
class Extends extends http.ServerResponse {}
class ExtendsWithAField extends http.ServerResponse {
  field = 1;
}
class ExtendsAnHeir extends Extends {
  constructor(req, options) {
    super(req, options);
    this.stored = 1;
  }
}
const classes = [Calls, CallsAndStores, StoresAndCalls, AppliesByReflect, Applies];
for (const Response of classes) {
  Object.setPrototypeOf(Response.prototype, http.ServerResponse.prototype);
  Object.setPrototypeOf(Response, http.ServerResponse);
}
classes.push(Extends, ExtendsWithAField, ExtendsAnHeir, http.ServerResponse);

const store = (name, message) => {
  message[kOutHeaders] = newMap();
  const seen = [
    message.getHeaders(),
    message.getHeaderNames(),
    message.getRawHeaderNames(),
    message.getHeader("x-two"),
  ];
  lines.push(name + " stores: " + show(seen) + " | " + show(message[kOutHeaders]));
};
const read = (name, message) => {
  message.setHeader("X-One", "1");
  lines.push(name + " reads: " + show(message[kOutHeaders]) + " | " + show(message.getHeaders()));
};

for (let i = 0; i < 70; i++) {
  for (const Response of classes) {
    store(Response.name + " " + i, new Response(new http.IncomingMessage(new net.Socket())));
    read(Response.name + " " + i, new Response(new http.IncomingMessage(new net.Socket())));
  }
}

async function serve(ServerResponse) {
  const server = http.createServer({ ServerResponse }, (req, res) => {
    (req.url.endsWith("/read") ? read : store)(req.url, res);
    res.end("ok");
  });
  await new Promise(resolve => server.listen(0, resolve));
  for (const path of ["/store", "/read", "/store", "/read"]) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/" + ServerResponse.name + path);
    const sent = ["x-one", "x-two", "x-list"].map(name => response.headers.get(name));
    lines.push("  " + show(sent) + " " + (await response.text()));
  }
  await new Promise(resolve => server.close(resolve));
}

(async () => {
  for (const Response of classes) await serve(Response);
  console.log(lines.join("\n"));
})();

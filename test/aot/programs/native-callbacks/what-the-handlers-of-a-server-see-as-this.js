// What the functions that a server is given see as `this` and as their arguments.
const lines = [];
let server;
function seen(name, self, given) {
  lines.push(name + ": this " + (self === undefined ? "undefined" : self === server ? "the server" : self === handlers ? "the handlers" : self === options ? "the options" : self === routes ? "the routes" : typeof self) + ", " + given.length + " arguments: " + Array.from(given, v => v === server ? "the server" : v === null ? "null" : typeof v === "object" ? v.constructor.name : typeof v).join());
}
let done;
const finished = new Promise(resolve => { done = resolve; });
const handlers = {
  open(socket) { seen("open", this, arguments); socket.subscribe("topic"); socket.send("first"); },
  message(socket, text) { seen("message", this, arguments); socket.ping(); socket.close(1000, "bye"); },
  close(socket, code, reason) { seen("close", this, arguments); done(); },
  drain(socket) { seen("drain", this, arguments); },
  ping(socket, data) { seen("ping", this, arguments); },
  pong(socket, data) { seen("pong", this, arguments); },
};
const routes = {
  "/plain": function (request) { seen("route", this, arguments); return new Response("plain"); },
  "/by-method": { GET(request) { seen("route GET", this, arguments); return new Response("get"); }, POST: function (request) { seen("route POST", this, arguments); return new Response("post"); } },
  "/with/:id": function (request) { seen("route with a parameter", this, arguments); return new Response(request.params.id); },
};
const options = {
  port: 0,
  routes,
  fetch(request, given) {
    seen("fetch", this, arguments);
    const path = new URL(request.url).pathname;
    if (path === "/socket") return given.upgrade(request) ? undefined : new Response("no");
    if (path === "/throws") throw new RangeError("midway");
    return new Response("fetch");
  },
  error(error) { seen("error", this, arguments); return new Response("error " + error.message); },
  websocket: handlers,
};
server = Bun.serve(options);
const base = `http://localhost:${server.port}`;
for (const [path, method] of [["/plain", "GET"], ["/by-method", "GET"], ["/by-method", "POST"], ["/with/7", "GET"], ["/other", "GET"], ["/throws", "GET"]])
  lines.push(path + " " + method + " > " + (await (await fetch(base + path, { method })).text()));
const client = new WebSocket(`ws://localhost:${server.port}/socket`);
client.onmessage = function (event) { seen("client message", this === client ? "client" : this, arguments); client.send("second"); };
await finished;
server.stop(true);
console.log(lines.sort().join("\n"));

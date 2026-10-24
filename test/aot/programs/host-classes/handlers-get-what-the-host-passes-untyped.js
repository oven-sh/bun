// What the host hands to the handlers of a server, a timer and a microtask, read by code without types.
const seen = [];
let closes = 0;
const finished = Promise.withResolvers();

const server = Bun.serve({
  port: 0,
  routes: {
    "/route/:id": (request, passedServer) =>
      new Response(`route ${request.params.id} ${request.method} ${passedServer === server} ${request instanceof Request}`),
    "/methods": {
      GET: request => new Response("get " + new URL(request.url).pathname),
      POST: async request => new Response("post " + (await request.text())),
    },
    "/fixed": new Response("fixed"),
  },
  fetch(request, passedServer) {
    const { pathname } = new URL(request.url);
    if (pathname === "/socket") {
      const upgraded = passedServer.upgrade(request, { data: { id: 7, tags: ["a", "b"] } });
      seen.push(`after upgrade ${upgraded}`);
      return upgraded ? undefined : new Response("no upgrade", { status: 400 });
    }
    if (pathname === "/throws") throw new RangeError("thrown by fetch");
    const host = typeof request.headers.get("host");
    return new Response(`fetch ${request.method} ${this === server} ${passedServer === server} ${request instanceof Request} ${host}`);
  },
  error(error) {
    return new Response(`error ${error instanceof RangeError} ${error.message}`, { status: 500 });
  },
  websocket: {
    open(socket) {
      seen.push(`open ${this === undefined} ${socket.data.id} ${socket.data.tags.join()} ${socket.readyState}`);
      socket.data.id++;
      socket.send("hello");
    },
    message(socket, message) {
      seen.push(`message ${typeof message} ${message} ${socket.data.id}`);
      socket.data = { id: 100, tags: [] };
      const before = closes;
      socket.close(1000, "done");
      seen.push(`closes around close() ${before} ${closes}`);
    },
    close(socket, code, reason) {
      closes++;
      seen.push(`close ${typeof code} ${code} ${typeof reason} ${reason} ${socket.data.id} ${socket.data.tags.length}`);
      finished.resolve();
    },
  },
});

const show = async (label, response) => console.log(label, response.status, await response.text());
const at = path => new URL(path, server.url);

await show("fetch", await fetch(at("/plain")));
await show("route", await fetch(at("/route/12")));
await show("get", await fetch(at("/methods")));
await show("post", await fetch(at("/methods"), { method: "POST", body: "sent" }));
await show("fixed", await fetch(at("/fixed")));
await show("error", await fetch(at("/throws")));
await show("server.fetch", await server.fetch(new Request(at("/plain"), { method: "PUT" })));

const client = new WebSocket(at("/socket").href.replace("http", "ws"));
client.onmessage = event => client.send("reply to " + event.data);
await finished.promise;
for (const line of seen) console.log(line);

const timer = setTimeout(function (first, second) {
  console.log("timer", this === timer, first, second.name);
}, 1, 5, { name: "passed" });
console.log("the callback of the timer", typeof timer._onTimeout, timer._onTimeout.length);
await new Promise(resolve => setTimeout(resolve, 20));

let ticks = 0;
await new Promise(resolve => {
  const interval = setInterval(step => {
    ticks += step;
    if (ticks === 6) {
      clearInterval(interval);
      resolve();
    }
  }, 1, 2);
});
console.log("interval", ticks);

const replaced = setTimeout(() => console.log("not called"), 5);
replaced._onTimeout = function () {
  console.log("replaced callback", this === replaced, arguments.length);
};
await new Promise(resolve => setTimeout(resolve, 30));

queueMicrotask(function () {
  console.log("microtask", this === undefined, arguments.length);
});
await null;
await server.stop(true);
console.log("done");

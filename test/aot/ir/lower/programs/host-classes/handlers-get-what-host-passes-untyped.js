// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: /route/:id POST error at
// CHECK-LABEL: function {{*}}name="/route/:id"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|BunRequest flags=[IsExpected]}, {type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|BunRequest, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Response" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="route "
// CHECK-NEXT: v6 = PropGet v0 key="params"
// CHECK-NEXT: v7 = PropGet v6 key="id"
// CHECK-NEXT: v8 = ToString v7
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = PropGet v0 key="method"
// CHECK-NEXT: v11 = ToString v10
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="server"
// CHECK-NEXT: v15 = StrictEq v1, v14
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = String string=" "
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="Request" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Request) flags=[IsExpected]}
// CHECK-NEXT: v21 = InstanceOf v0, v20
// CHECK-NEXT: v22 = ToString v21
// CHECK-NEXT: v23 = Strcat v5, v8, v9, v11, v12, v16, v17, v22
// CHECK-NEXT: v24 = Construct v4, -, v23 calleeName="Response"
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="POST"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|BunRequest flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|BunRequest):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Response" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="post "
// CHECK-NEXT: v5 = PropGet v0 key="text"
// CHECK-NEXT: v6 = Call v5, v0 calleeKey="text" calleeName="request.text"
// CHECK-NEXT: v7 = Await v6, v0
// CHECK-NEXT: v8 = Add v4, v7
// CHECK-NEXT: v9 = Construct v3, -, v8 calleeName="Response"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="error"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]]|Error flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]|Error):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Response" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="error "
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="RangeError" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v8 = InstanceOf v0, v7
// CHECK-NEXT: v9 = ToString v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = PropGet v0 key="message"
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = Strcat v4, v9, v10, v12
// CHECK-NEXT: v14 = Data data=[[d_4]]
// CHECK-NEXT: v15 = Construct v3, -, v13, v14 calleeName="Response"
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="at"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string|URL flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|URL):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="URL" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(URL) flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="server"
// CHECK-NEXT: v6 = PropGet v5 key="url"
// CHECK-NEXT: v7 = Construct v3, -, v0, v6 calleeName="URL"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }

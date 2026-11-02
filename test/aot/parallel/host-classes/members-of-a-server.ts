const closed: string[] = [];
let seenByHandler: unknown;

// The declarations of Bun's types leave `address` out.
type WithAddress = Bun.Server<undefined> & { address: string | null | { address: string; family: string; port: number } };

const server: WithAddress = Bun.serve({
  port: 0,
  fetch(request, itself): Response | undefined {
    seenByHandler = this;
    const path = new URL(request.url).pathname;
    if (path === "/socket") return itself.upgrade(request) ? undefined : new Response("no upgrade", { status: 400 });
    if (path === "/ip") {
      const ip = itself.requestIP(request);
      return Response.json({ keys: ip && Object.keys(ip).sort(), port: typeof ip?.port, family: typeof ip?.family });
    }
    if (path === "/timeout") return new Response(String(itself.timeout(request, 5)));
    return new Response(`${server.pendingRequests > 0} ${itself === undefined ? "no second argument" : itself === server}`);
  },
  websocket: {
    message() {},
    close(_socket, code) {
      closed.push(`closed ${typeof code}`);
    },
  },
}) as WithAddress;

const describe = (value: unknown) =>
  value === null ? "null" : typeof value === "object" ? Object.prototype.toString.call(value) : typeof value;

console.log("port", describe(server.port), server.port === server.port, server.port! > 0);
console.log("url", describe(server.url), server.url instanceof URL, server.url === server.url, server.url.port === String(server.port));
console.log("hostname", describe(server.hostname), server.hostname);
console.log("protocol", server.protocol);
console.log("development", describe(server.development));
console.log("id", describe(server.id));
console.log("address", describe(server.address), Object.keys(server.address!).sort().join(), server.address === server.address);
console.log("pending", server.pendingRequests, server.pendingWebSockets);
console.log("ref", server.ref() === (server as unknown), server.unref() === (server as unknown), server.ref() === (server as unknown));

console.log("plain", await (await fetch(server.url)).text(), seenByHandler === server);
console.log("ip", await (await fetch(new URL("/ip", server.url))).text());
console.log("timeout", await (await fetch(new URL("/timeout", server.url))).text());
console.log("through fetch", await (await server.fetch(new Request(server.url))).text(), seenByHandler === server);
console.log("through fetch by text", await (await server.fetch("/")).text());

for (const wrong of [undefined, 1, {}, new Response("")]) {
  try {
    console.log("requestIP", describe(wrong), describe(server.requestIP(wrong as Request)));
  } catch (error) {
    console.log("requestIP", describe(wrong), "throws", (error as Error).name);
  }
}
for (const method of ["stop", "ref", "requestIP", "closeIdleConnections"] as const) {
  try {
    (server[method] as Function).call({});
    console.log(method, "took another receiver");
  } catch (error) {
    console.log(method, "on another receiver throws", (error as Error).name);
  }
}

const socket = new WebSocket(new URL("/socket", server.url).href.replace("http", "ws"));
await new Promise(resolve => (socket.onopen = resolve));
console.log("sockets", server.pendingWebSockets);
console.log("idle", describe(server.closeIdleConnections()));

const first = server.stop(true);
const second = server.stop(true);
console.log("stop", describe(first), first instanceof Promise, describe(second));
console.log("stopped", describe(await first), closed.join());
console.log("dispose", describe(server[Symbol.dispose]()));
console.log("after", describe(server.port), describe(server.url), server.pendingWebSockets);

const path = `${process.env.TMPDIR ?? "/tmp"}/members-of-a-server-${process.pid}.sock`;
if (process.platform !== "win32") {
  using local = Bun.serve({ unix: path, fetch: () => new Response("local") }) as WithAddress;
  console.log("unix", describe(local.port), describe(local.hostname), describe(local.address), local.address === path);
  console.log("unix", await (await fetch("http://localhost/", { unix: path })).text());
}
